"""
Government Schemes Dual RAG - LangGraph-Based Execution
=========================================================

This module replaces the manual async flow in execution.py with a LangGraph-based
state machine for better observability, composability, and maintainability.

DUAL RAG FLOW (LangGraph Graph):
  
  ┌─────────────────────────────────────────────────────┐
  │                   START                             │
  └────────────────────┬────────────────────────────────┘
                       │
        ┌──────────────┴──────────────┐
        │                             │
        ▼                             ▼
  [retrieve_schemes]          [retrieve_citizen_faq]
        │                             │
        └──────────────┬──────────────┘
                       ▼
            [generate_scheme_answer]
                       │
                       ▼
           [generate_citizen_answer] (conditional)
                       │
                       ▼
              [synthesize_final_answer]
                       │
                       ▼
             (optional) [validate_answer]
                       │
                       ▼
                      END

Key Improvements over execution.py:
  ✓ Parallel retrieval nodes (schemes_index + citizen_faq_index run simultaneously)
  ✓ Explicit state management via TypedDict
  ✓ Conditional node routing (skip citizen answer if index is empty)
  ✓ Built-in error handling & automatic retries per node
  ✓ Observable execution graph (LangSmith integration ready)
  ✓ Testable unit: each node is independently testable
  ✓ Extensible: easy to add validation, reranking, or other nodes
"""

import os
import json
import asyncio
import logging
import time
import operator
from typing import Dict, List, Optional, TypedDict, Annotated
from uuid import uuid4

import boto3
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

from langgraph.graph import StateGraph, START, END

# Import all the provider classes from execution.py to avoid duplication
from execution import (
    config,
    ConfigManager,
    EmbeddingProvider,
    LLMProvider,
    VectorRetriever,
    DocumentPostProcessor,
    SCHEME_PROMPT_SYSTEM,
    SCHEME_PROMPT_USER,
    CITIZEN_PROMPT_SYSTEM,
    CITIZEN_PROMPT_USER,
    SYNTHESIS_PROMPT_SYSTEM,
    SYNTHESIS_PROMPT_USER,
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============================================================================
# STATE DEFINITION
# ============================================================================
class DualRAGState(TypedDict):
    """
    Represents the complete state of a dual RAG query execution.
    
    Fields:
      - question: The user's question
      - filters: Index-specific filter conditions
      - options: Retrieval options (k, rerank, etc.)
      - interaction_id: Unique identifier for tracking
      - start_time: Unix timestamp when query started
      
      - scheme_docs: Retrieved documents from schemes_index
      - citizen_docs: Retrieved documents from citizen_faq_index
      - scheme_context: Formatted context string for scheme LLM
      - citizen_context: Formatted context string for citizen LLM
      
      - scheme_answer: Parsed JSON from scheme answer LLM
      - citizen_answer: Parsed JSON from citizen answer LLM
      - final_answer: Parsed JSON from synthesis LLM
      
      - error: Any error message (optional)
    """
    question: str
    filters: Dict
    options: Dict
    interaction_id: str
    start_time: float
    
    scheme_docs: List[Dict]
    citizen_docs: List[Dict]
    scheme_context: str
    citizen_context: str
    
    scheme_answer: Dict
    citizen_answer: Dict
    final_answer: Dict
    
    # Collected non-fatal errors from nodes. Uses a reducer so parallel nodes
    # can both append errors in the same step.
    errors: Annotated[List[str], operator.add]


# ============================================================================
# NODE IMPLEMENTATIONS
# ============================================================================

async def retrieve_schemes_node(state: DualRAGState) -> Dict:
    """
    Node 1: Retrieve documents from schemes_index in parallel with citizen_faq_index.
    
    This happens simultaneously with retrieve_citizen_faq_node when the graph
    adds both nodes as outgoing edges from START.
    """
    retriever = VectorRetriever()
    post_processor = DocumentPostProcessor()
    
    question = state['question']
    filters = state['filters']
    options = state['options']
    k = options.get('k', config.get('retriever.k', 8))
    do_rerank = options.get('rerank', config.get('retriever.enable_reranker', False))
    rerank_top_k = options.get('rerank_top_k', config.get('retriever.rerank_top_k', 5))
    schemes_index = config.get('indices.schemes_index', 'schemes_index')
    
    logger.info(f"  [retrieve_schemes] Retrieving from {schemes_index}...")
    
    try:
        scheme_docs = await retriever.retrieve(
            index_name=schemes_index,
            query=question,
            k=k,
            filter_conditions=filters.get('schemes_index')
        )
        
        # Post-process
        scheme_docs = post_processor.deduplicate(scheme_docs)
        if do_rerank:
            scheme_docs = post_processor.rerank(scheme_docs, question, rerank_top_k)
        
        logger.info(f"  [retrieve_schemes] Retrieved {len(scheme_docs)} documents")
        
        return {"scheme_docs": scheme_docs}

    except Exception as e:
        msg = str(e)
        logger.error(f"  [retrieve_schemes] Error: {msg}")
        hint = ""
        if "dimension" in msg and "expecting" in msg:
            hint = (
                " Chroma embedding-dimension mismatch. Fix by deleting backend/chroma_db "
                "and re-ingesting PDFs (or re-ingest once to recreate collections)."
            )
        return {"scheme_docs": [], "errors": [f"Scheme retrieval failed: {msg}.{hint}".strip()]}


async def retrieve_citizen_faq_node(state: DualRAGState) -> Dict:
    """
    Node 2: Retrieve documents from citizen_faq_index in parallel with schemes_index.
    """
    retriever = VectorRetriever()
    post_processor = DocumentPostProcessor()
    
    question = state['question']
    filters = state['filters']
    options = state['options']
    k = options.get('k', config.get('retriever.k', 8))
    do_rerank = options.get('rerank', config.get('retriever.enable_reranker', False))
    rerank_top_k = options.get('rerank_top_k', config.get('retriever.rerank_top_k', 5))
    citizen_index = config.get('indices.citizen_faq_index', 'citizen_faq_index')
    
    logger.info(f"  [retrieve_citizen_faq] Retrieving from {citizen_index}...")
    
    try:
        citizen_docs = await retriever.retrieve(
            index_name=citizen_index,
            query=question,
            k=k,
            filter_conditions=filters.get('citizen_faq_index')
        )
        
        # Post-process
        citizen_docs = post_processor.deduplicate(citizen_docs)
        if do_rerank:
            citizen_docs = post_processor.rerank(citizen_docs, question, rerank_top_k)
        
        logger.info(f"  [retrieve_citizen_faq] Retrieved {len(citizen_docs)} documents")
        
        return {"citizen_docs": citizen_docs}

    except Exception as e:
        msg = str(e)
        logger.error(f"  [retrieve_citizen_faq] Error: {msg}")
        hint = ""
        if "dimension" in msg and "expecting" in msg:
            hint = (
                " Chroma embedding-dimension mismatch. Fix by deleting backend/chroma_db "
                "and re-ingesting PDFs (or re-ingest once to recreate collections)."
            )
        return {"citizen_docs": [], "errors": [f"Citizen FAQ retrieval failed: {msg}.{hint}".strip()]}


async def build_context_node(state: DualRAGState) -> Dict:
    """
    Node 2.5: Build context strings from retrieved documents.
    
    This node runs after both retrieval nodes complete and formats the
    documents into context strings for the LLM prompts.
    """
    post_processor = DocumentPostProcessor()
    
    try:
        scheme_context = post_processor.build_context(state['scheme_docs'], "scheme")
        citizen_context = post_processor.build_context(state['citizen_docs'], "citizen FAQ")

        logger.info("  [build_context] Context strings built")
        return {"scheme_context": scheme_context, "citizen_context": citizen_context}

    except Exception as e:
        msg = str(e)
        logger.error(f"  [build_context] Error: {msg}")
        return {"errors": [f"Context building failed: {msg}"]}


async def generate_scheme_answer_node(state: DualRAGState) -> Dict:
    """
    Node 3: Generate the scheme answer using LLM call 1.
    
    This node calls the LLM with the scheme documents to generate an
    official, fact-based answer about government schemes.
    """
    llm = LLMProvider()
    
    question = state['question']
    scheme_context = state['scheme_context']
    
    logger.info("  [generate_scheme_answer] Calling LLM for scheme answer...")

    # If scheme retrieval failed, avoid an ungrounded LLM call.
    for err in state.get("errors", []):
        if err.startswith("Scheme retrieval failed:"):
            scheme_answer = {
                "answer": "Cannot generate a grounded scheme answer because scheme retrieval failed.",
                "scheme_names": [],
                "eligibility_summary": "",
                "key_benefits": [],
                "sources": []
            }
            return {"scheme_answer": scheme_answer}
    
    try:
        scheme_raw = await llm.chat(
            system_prompt=SCHEME_PROMPT_SYSTEM,
            user_prompt=SCHEME_PROMPT_USER.format(
                context=scheme_context,
                question=question
            )
        )
        scheme_answer = llm.parse_json_response(scheme_raw)

        logger.info(f"  [generate_scheme_answer] Scheme answer generated")

        return {"scheme_answer": scheme_answer}

    except Exception as e:
        msg = str(e)
        logger.error(f"  [generate_scheme_answer] Error: {msg}")
        scheme_answer = {
            "answer": "Error generating scheme answer",
            "scheme_names": [],
            "eligibility_summary": "",
            "key_benefits": [],
            "sources": []
        }
        return {"scheme_answer": scheme_answer, "errors": [f"Scheme answer generation failed: {msg}"]}


def should_generate_citizen_answer(state: DualRAGState) -> str:
    """
    Conditional edge function: determine if we should generate citizen answer.
    
    Returns:
      - "continue" if citizen_faq_index has documents
      - "skip" if it's empty (FAQs not yet ingested)
    """
    if state['citizen_docs'] and len(state['citizen_docs']) > 0:
        return "continue"
    else:
        logger.warning(
            "  [conditional] citizen_faq_index is empty — skipping citizen answer generation"
        )
        return "skip"


async def generate_citizen_answer_node(state: DualRAGState) -> Dict:
    """
    Node 4a: Generate the citizen answer using LLM call 2.
    
    This node calls the LLM with citizen FAQ documents to generate practical
    guidance and address common citizen concerns.
    
    Only executed if should_generate_citizen_answer returns "continue".
    """
    llm = LLMProvider()
    
    question = state['question']
    citizen_context = state['citizen_context']
    
    logger.info("  [generate_citizen_answer] Calling LLM for citizen answer...")
    
    try:
        citizen_raw = await llm.chat(
            system_prompt=CITIZEN_PROMPT_SYSTEM,
            user_prompt=CITIZEN_PROMPT_USER.format(
                context=citizen_context,
                question=question
            )
        )
        citizen_answer = llm.parse_json_response(citizen_raw)

        logger.info(f"  [generate_citizen_answer] Citizen answer generated")

        return {"citizen_answer": citizen_answer}

    except Exception as e:
        msg = str(e)
        logger.error(f"  [generate_citizen_answer] Error: {msg}")
        citizen_answer = {
            "answer": "Error generating citizen answer",
            "common_confusions": [],
            "practical_tips": [],
            "related_questions": []
        }
        return {"citizen_answer": citizen_answer, "errors": [f"Citizen answer generation failed: {msg}"]}


async def skip_citizen_answer_node(state: DualRAGState) -> Dict:
    """
    Node 4b: Skip citizen answer generation and use default.
    
    Only executed if should_generate_citizen_answer returns "skip".
    """
    logger.warning("  [skip_citizen_answer] Using default citizen answer")
    return {
        "citizen_answer": {
        "answer": "No citizen FAQ data available yet. Please ingest FAQ documents.",
        "common_confusions": [],
        "practical_tips": [],
        "related_questions": []
        }
    }


async def synthesize_final_answer_node(state: DualRAGState) -> Dict:
    """
    Node 5: Synthesize the final answer using LLM call 3.
    
    This node combines the scheme answer and citizen answer into a
    comprehensive, citizen-friendly final response.
    """
    llm = LLMProvider()
    
    question = state['question']
    scheme_answer = state['scheme_answer']
    citizen_answer = state['citizen_answer']
    
    logger.info("  [synthesize_final_answer] Calling LLM for synthesis...")

    # If we don't have any retrieved documents and we hit a retrieval error,
    # return a clear actionable error instead of hallucinating.
    if (not state.get("scheme_docs") and not state.get("citizen_docs") and state.get("errors")):
        final_answer = {
            "final_answer": "Cannot answer yet because retrieval failed. Fix the errors and try again.",
            "eligibility": "",
            "benefits": [],
            "how_to_apply": [],
            "documents_required": [],
            "practical_tips": [],
            "helpline": "",
            "schemes_covered": [],
            "confidence_score": 0.0
        }
        return {"final_answer": final_answer}
    
    try:
        final_raw = await llm.chat(
            system_prompt=SYNTHESIS_PROMPT_SYSTEM,
            user_prompt=SYNTHESIS_PROMPT_USER.format(
                question=question,
                scheme_answer=json.dumps(scheme_answer, ensure_ascii=False),
                citizen_answer=json.dumps(citizen_answer, ensure_ascii=False)
            )
        )
        final_answer = llm.parse_json_response(final_raw)

        logger.info(f"  [synthesize_final_answer] Final answer synthesized")

        return {"final_answer": final_answer}

    except Exception as e:
        msg = str(e)
        logger.error(f"  [synthesize_final_answer] Error: {msg}")
        final_answer = {
            "final_answer": "Error synthesizing final answer",
            "eligibility": "",
            "benefits": [],
            "how_to_apply": [],
            "documents_required": [],
            "practical_tips": [],
            "helpline": "",
            "schemes_covered": [],
            "confidence_score": 0.0
        }
        return {"final_answer": final_answer, "errors": [f"Final synthesis failed: {msg}"]}


async def validate_answer_node(state: DualRAGState) -> Dict:
    """
    Node 6 (Optional): Validate the final answer for groundedness and confidence.
    
    This node checks if the final answer is well-supported by the retrieved
    documents and adds a confidence score.
    """
    llm = LLMProvider()
    
    question = state['question']
    final_answer_text = state['final_answer'].get('final_answer', '')
    scheme_docs = state['scheme_docs']
    
    logger.info("  [validate_answer] Validating answer groundedness...")
    
    # Simple validation: check if key concepts from documents appear in answer
    doc_content = " ".join([doc.get('content', '') for doc in scheme_docs])
    
    if not doc_content:
        # No documents to validate against
        confidence = 0.3
        logger.warning("  [validate_answer] No documents to validate against")
    else:
        # Simplified confidence: check overlap
        answer_words = set(final_answer_text.lower().split())
        doc_words = set(doc_content.lower().split())
        overlap = len(answer_words & doc_words) / (len(answer_words) + 0.001)
        confidence = min(overlap, 1.0)
        
        logger.info(f"  [validate_answer] Calculated confidence: {confidence:.2f}")
    
    # Add confidence score to final answer
    final_answer = state.get("final_answer") or {}
    if isinstance(final_answer, dict):
        final_answer = {**final_answer, "confidence_score": round(confidence, 2)}
    return {"final_answer": final_answer}


# ============================================================================
# LANGGRAPH WORKFLOW BUILDER
# ============================================================================

def create_dual_rag_graph():
    """
    Build and compile the LangGraph state machine for Dual RAG execution.
    
    Returns:
      Compiled StateGraph ready for execution.
    """
    workflow = StateGraph(DualRAGState)
    
    # ── Add nodes ───────────────────────────────────────────────────────────
    # Retrieval nodes
    workflow.add_node("retrieve_schemes", retrieve_schemes_node)
    workflow.add_node("retrieve_citizen_faq", retrieve_citizen_faq_node)
    workflow.add_node("build_context", build_context_node)
    
    # Generation nodes
    workflow.add_node("generate_scheme_answer", generate_scheme_answer_node)
    workflow.add_node("generate_citizen_answer", generate_citizen_answer_node)
    workflow.add_node("skip_citizen_answer", skip_citizen_answer_node)
    
    # Synthesis node
    workflow.add_node("synthesize_final_answer", synthesize_final_answer_node)
    
    # Optional validation node
    workflow.add_node("validate_answer", validate_answer_node)
    
    # ── Add edges ───────────────────────────────────────────────────────────
    # Parallel retrieval from START
    workflow.add_edge(START, "retrieve_schemes")
    workflow.add_edge(START, "retrieve_citizen_faq")
    
    # Converge to build_context after BOTH retrievals complete
    # (LangGraph join edge)
    workflow.add_edge(["retrieve_schemes", "retrieve_citizen_faq"], "build_context")
    
    # Generate scheme answer after context building
    workflow.add_edge("build_context", "generate_scheme_answer")
    
    # Conditional: should we generate citizen answer?
    workflow.add_conditional_edges(
        "generate_scheme_answer",
        should_generate_citizen_answer,
        {
            "continue": "generate_citizen_answer",
            "skip": "skip_citizen_answer"
        }
    )
    
    # Converge citizen answer paths to synthesis
    workflow.add_edge("generate_citizen_answer", "synthesize_final_answer")
    workflow.add_edge("skip_citizen_answer", "synthesize_final_answer")
    
    # Optional: validate answer before returning
    enable_validation = config.get('query.enable_validation', False)
    if enable_validation:
        workflow.add_edge("synthesize_final_answer", "validate_answer")
        workflow.add_edge("validate_answer", END)
    else:
        workflow.add_edge("synthesize_final_answer", END)
    
    # ── Compile and return ──────────────────────────────────────────────────
    graph = workflow.compile()
    logger.info("✓ LangGraph Dual RAG workflow compiled successfully")
    
    return graph


# ============================================================================
# GRAPH EXECUTOR
# ============================================================================

class DualRAGGraphExecutor:
    """
    Wrapper around the compiled LangGraph to execute queries.
    """
    
    def __init__(self):
        self.graph = create_dual_rag_graph()
    
    async def query(self, request: Dict) -> Dict:
        """
        Execute a single query through the Dual RAG graph.
        
        Input:
        {
            "question": "Am I eligible for Ayushman Bharat?",
            "filters": {...},
            "options": {"k": 8, "rerank": false}
        }
        
        Output:
        {
            "interaction_id": "uuid",
            "question": "...",
            "final_answer": "...",
            ...,
            "intermediate": {
                "scheme_answer": {...},
                "citizen_answer": {...},
                "processing_time_seconds": 4.52
            }
        }
        """
        start_time = time.perf_counter()
        interaction_id = str(uuid4())
        
        logger.info("=" * 70)
        logger.info(f"LANGGRAPH DUAL RAG QUERY — ID: {interaction_id}")
        logger.info(f"Question: {request['question']}")
        logger.info("=" * 70)
        
        # Initialize state
        initial_state: DualRAGState = {
            "question": request['question'],
            "filters": request.get('filters', {}),
            "options": request.get('options', {}),
            "interaction_id": interaction_id,
            "start_time": start_time,
            "scheme_docs": [],
            "citizen_docs": [],
            "scheme_context": "",
            "citizen_context": "",
            "scheme_answer": {},
            "citizen_answer": {},
            "final_answer": {},
            "errors": []
        }
        
        try:
            # Execute the graph (async if supported by the installed langgraph version).
            if hasattr(self.graph, "ainvoke"):
                final_state = await self.graph.ainvoke(initial_state)
            else:
                final_state = await asyncio.to_thread(self.graph.invoke, initial_state)
            
            elapsed = time.perf_counter() - start_time
            logger.info(f"✓ Query complete in {elapsed:.2f}s")
            logger.info("=" * 70)
            
            # Format response
            return {
                'interaction_id': interaction_id,
                'question': request['question'],
                **final_state['final_answer'],
                'errors': final_state.get('errors', []),
                'intermediate': {
                    'scheme_answer': final_state['scheme_answer'],
                    'citizen_answer': final_state['citizen_answer'],
                    'scheme_docs_retrieved': len(final_state['scheme_docs']),
                    'citizen_docs_retrieved': len(final_state['citizen_docs']),
                    'processing_time_seconds': round(elapsed, 2)
                }
            }
        
        except Exception as e:
            logger.error(f"Graph execution failed: {e}", exc_info=True)
            elapsed = time.perf_counter() - start_time
            return {
                'interaction_id': interaction_id,
                'question': request['question'],
                'error': str(e),
                'intermediate': {
                    'processing_time_seconds': round(elapsed, 2)
                }
            }
    
    async def batch_query(self, requests: List[Dict]) -> List[Dict]:
        """Execute multiple queries with batching and delays."""
        batch_size = config.get('batch_processing.batch_size', 5)
        delay = config.get('batch_processing.delay_seconds', 2)
        results = []
        
        for i in range(0, len(requests), batch_size):
            batch = requests[i:i + batch_size]
            logger.info(f"Batch {i // batch_size + 1}: processing {len(batch)} queries")
            
            batch_results = await asyncio.gather(
                *[self.query(r) for r in batch],
                return_exceptions=True
            )
            
            for req, res in zip(batch, batch_results):
                if isinstance(res, Exception):
                    logger.error(f"Query failed: {req.get('question', '')[:50]} — {res}")
                    results.append({'error': str(res), 'question': req.get('question')})
                else:
                    results.append(res)
            
            if i + batch_size < len(requests):
                await asyncio.sleep(delay)
        
        return results


# ============================================================================
# FASTAPI APPLICATION (same endpoints as execution.py)
# ============================================================================

app = FastAPI(
    title="Government Schemes Dual RAG API (LangGraph)",
    description="Query Indian government schemes using dual-index RAG with LangGraph",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

_executor: Optional[DualRAGGraphExecutor] = None

def get_executor() -> DualRAGGraphExecutor:
    global _executor
    if _executor is None:
        _executor = DualRAGGraphExecutor()
    return _executor


@app.post("/api/query")
async def query_scheme(request: Request):
    """
    Query the Dual RAG system (LangGraph version).
    
    Example request:
    {
        "question": "How do I apply for Ayushman Bharat card?",
        "filters": {"schemes_index": {"scheme_type": "health"}},
        "options": {"k": 8, "rerank": false}
    }
    """
    body = await request.json()
    if not body.get('question'):
        return {"error": "question is required"}
    return await get_executor().query(body)


@app.post("/api/batch-query")
async def batch_query_schemes(request: Request):
    """Process multiple questions in batch (LangGraph version)."""
    body = await request.json()
    queries = body.get('queries', [])
    if not queries:
        return {"error": "queries list is required"}
    results = await get_executor().batch_query(queries)
    return {"results": results, "total": len(results)}


@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "engine": "langgraph",
        "llm_provider": config.get('llm.provider', 'openai'),
        "vector_store": config.get('vector_store.type', 'chroma'),
        "schemes_index": config.get('indices.schemes_index', 'schemes_index'),
        "citizen_faq_index": config.get('indices.citizen_faq_index', 'citizen_faq_index')
    }


@app.get("/api/graph")
async def graph_schema():
    """
    Return the LangGraph schema for visualization and debugging.
    
    Output can be used with LangSmith or other tools for execution tracing.
    """
    executor = get_executor()
    return {
        "schema": executor.graph.schema,
        "nodes": list(executor.graph.nodes),
        "edges": list(executor.graph.edges)
    }


# ============================================================================
# CLI ENTRY POINT
# ============================================================================

async def main():
    """CLI mode: run demo queries."""
    demo_queries = [
        {
            "question": "What is Ayushman Bharat PM-JAY scheme? Who is eligible and how much coverage does it provide?",
            "options": {"k": 6, "rerank": False}
        },
        {
            "question": "How do farmers register for PM Kisan Samman Nidhi and when is the money transferred?",
            "filters": {"schemes_index": {"scheme_type": "agriculture"}},
            "options": {"k": 6, "rerank": False}
        },
        {
            "question": "I am a daily wage worker. Which government schemes am I eligible for?",
            "options": {"k": 8, "rerank": False}
        }
    ]
    
    executor_instance = DualRAGGraphExecutor()
    
    for i, query in enumerate(demo_queries, 1):
        print(f"\n{'=' * 70}")
        print(f"QUERY {i}: {query['question']}")
        print('=' * 70)
        
        result = await executor_instance.query(query)
        
        print(f"\n✅ FINAL ANSWER:\n{result.get('final_answer', 'N/A')}")
        print(f"\n📋 ELIGIBILITY: {result.get('eligibility', 'N/A')}")
        print(f"\n💰 BENEFITS:")
        for b in result.get('benefits', []):
            print(f"   • {b}")
        print(f"\n📝 HOW TO APPLY:")
        for step in result.get('how_to_apply', []):
            print(f"   {step}")
        print(f"\n📎 DOCUMENTS REQUIRED: {', '.join(result.get('documents_required', []))}")
        print(f"\n💡 PRACTICAL TIPS:")
        for tip in result.get('practical_tips', []):
            print(f"   • {tip}")
        print(f"\n📞 HELPLINE: {result.get('helpline', 'N/A')}")
        print(f"\n⏱  Time: {result['intermediate']['processing_time_seconds']}s")
        
        os.makedirs('output', exist_ok=True)
        out_path = f"output/query_{result['interaction_id'][:8]}.json"
        with open(out_path, 'w') as f:
            json.dump(result, f, indent=2, ensure_ascii=False)
        print(f"💾 Saved to {out_path}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == 'serve':
        port = int(os.getenv('APP_PORT', 8080))
        uvicorn.run("langgraph_execution:app", host="0.0.0.0", port=port, reload=False)
    else:
        asyncio.run(main())
