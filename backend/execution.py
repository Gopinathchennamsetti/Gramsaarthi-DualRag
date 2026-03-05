"""
Government Schemes Dual RAG - Execution (Retrieval + Generation) Pipeline
==========================================================================

DUAL RAG FLOW:
  Query →
    ├── INDEX 1 (schemes_index)      → Official scheme details
    └── INDEX 2 (citizen_faq_index)  → Common citizen questions & clarifications
          ↓                                    ↓
       Scheme Answer              +      Citizen Context Answer
                    ↓
             LLM Synthesis
                    ↓
        Final Comprehensive Answer
        (What the scheme offers + practical citizen guidance)

LLM PROVIDERS (config.json):
  - openai   → gpt-4o (best quality)
  - gemini   → gemini-2.5-flash + gemini-embedding-001
  - bedrock  → claude-3-sonnet / amazon.titan (production)

COMPATIBILITY: Mirrors ingestion_pipeline.py exactly for:
  - EmbeddingProvider (same provider dispatch + local fallback)
  - VectorStoreProvider._get_chroma_collection (same recreate logic)
  - Config key paths
"""

import os

from dotenv import load_dotenv
# Load .env relative to this file's directory, not cwd.
# This ensures `python /some/path/execution.py` always finds the right .env.
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

import json
import asyncio
import logging
import time
from typing import Dict, List, Optional
from uuid import uuid4

import boto3

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============================================================================
# CONFIGURATION  — identical to ingestion_pipeline.py
# ============================================================================
class ConfigManager:
    def __init__(self):
        self.config = self._load_config()
        self.env = os.getenv('APP_ENV', 'local')
        logger.info(
            f"Config loaded. LLM: {self.get('llm.provider', 'openai')} | "
            f"Store: {self.get('vector_store.type', 'chroma')}"
        )

    def _load_config(self) -> Dict:
        config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
        if os.path.exists(config_path):
            with open(config_path) as f:
                return json.load(f)
        logger.warning(f"config.json not found at {config_path} — using defaults")
        return {}

    def get(self, key: str, default=None):
        keys = key.split('.')
        val = self.config
        for k in keys:
            if isinstance(val, dict):
                val = val.get(k)
                if val is None:
                    return default
            else:
                return default
        return val if val is not None else default


config = ConfigManager()


# ── Startup validation: catch missing API keys immediately ────────────────────
def _validate_env():
    provider = config.get('llm.provider', 'openai')
    key_map = {
        'openai':  ('OPENAI_API_KEY',  'https://platform.openai.com/api-keys'),
        'gemini':  ('GEMINI_API_KEY',  'https://ai.google.dev/gemini-api/docs/api-key'),
    }
    if provider in key_map:
        env_var, url = key_map[provider]
        if not os.getenv(env_var):
            raise EnvironmentError(
                f"\n\n{'='*60}\n"
                f"  MISSING API KEY: {env_var}\n"
                f"  Provider '{provider}' is selected in config.json but\n"
                f"  {env_var} is not set in your .env file.\n\n"
                f"  Fix:\n"
                f"    1. Copy .env.template → .env  (if you haven't already)\n"
                f"    2. Open .env and set:  {env_var}=your-key-here\n"
                f"    3. Get a key at: {url}\n"
                f"{'='*60}\n"
            )
    elif provider == 'bedrock':
        if not os.getenv('AWS_ACCESS_KEY_ID') and not os.getenv('AWS_PROFILE'):
            logger.warning(
                "Bedrock provider selected but no AWS credentials found. "
                "Set AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY or configure an AWS profile."
            )

_validate_env()


# (same provider dispatch, same Gemini client style, same local fallback)
# ============================================================================
class EmbeddingProvider:

    def __init__(self):
        self.provider = config.get('llm.provider', 'openai')
        self._client = None
        self._bedrock_client = None
        self._local_model = None

    # ── Local fallback (sentence-transformers) ────────────────────────────────
    def _get_local_model(self):
        if not self._local_model:
            from sentence_transformers import SentenceTransformer
            model_name = config.get(
                'llm.fallback_embedding_model',
                'BAAI/bge-small-en-v1.5'
            )
            logger.warning(f"⚠ Falling back to OPEN SOURCE embeddings: {model_name}")
            self._local_model = SentenceTransformer(model_name)
        return self._local_model

    async def _embed_local(self, texts: List[str]) -> List[List[float]]:
        model = self._get_local_model()
        vectors = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return vectors.tolist()

    # ── Provider clients ──────────────────────────────────────────────────────
    def _get_openai_client(self):
        if not self._client:
            from openai import OpenAI
            self._client = OpenAI(api_key=os.getenv('OPENAI_API_KEY'))
        return self._client

    def _get_gemini_client(self):
        # Uses google.genai.Client — matches ingestion_pipeline.py
        if not self._client:
            from google import genai
            self._client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))
        return self._client

    def _get_bedrock_client(self):
        if not self._bedrock_client:
            self._bedrock_client = boto3.client(
                'bedrock-runtime',
                region_name=config.get('aws.region', 'us-east-1')
            )
        return self._bedrock_client

    # ── Main entry with fallback — mirrors ingestion_pipeline.py ─────────────
    async def embed_texts(self, texts: List[str]) -> List[List[float]]:
        try:
            if self.provider == 'openai':
                return await self._embed_openai(texts)
            elif self.provider == 'gemini':
                return await self._embed_gemini(texts)
            elif self.provider == 'bedrock':
                return await self._embed_bedrock(texts)
            else:
                raise ValueError(f"Unknown provider: {self.provider}")
        except Exception as e:
            err = str(e)
            # Never silently fall back on auth/key errors — the fallback model
            # produces 384-dim vectors which mismatch a 3072-dim Chroma collection.
            if any(kw in err for kw in ('API_KEY', 'API key', 'INVALID_ARGUMENT',
                                         'UNAUTHENTICATED', 'credentials',
                                         'unauthorized', '401', '403')):
                raise RuntimeError(
                    f"\n{'='*60}\n"
                    f"  AUTH ERROR — embedding provider '{self.provider}' rejected the key.\n"
                    f"  Not falling back (would cause dimension mismatch in Chroma).\n\n"
                    f"  Fix: open .env in a text editor and ensure there is only ONE\n"
                    f"  GEMINI_API_KEY line with a valid, unexpired key.\n"
                    f"  (Using >> to append creates duplicate lines — the first wins.)\n"
                    f"{'='*60}"
                ) from e
            logger.error(f"Primary embedding provider '{self.provider}' failed: {e}")
            logger.warning("Switching to OPEN SOURCE embedding fallback")
            return await self._embed_local(texts)

    async def embed_query(self, text: str) -> List[float]:
        results = await self.embed_texts([text])
        return results[0]

    async def _embed_openai(self, texts: List[str]) -> List[List[float]]:
        client = self._get_openai_client()
        response = client.embeddings.create(
            input=texts,
            model=config.get('llm.embedding_model', 'text-embedding-3-small')
        )
        return [item.embedding for item in response.data]

    async def _embed_gemini(self, texts: List[str]) -> List[List[float]]:
        # gemini-embedding-001 does not support batch lists via embed_content;
        # we must call it once per text and collect results.
        client = self._get_gemini_client()
        model = config.get('llm.embedding_model', 'models/gemini-embedding-001')
        embeddings = []
        for i, text in enumerate(texts):
            result = client.models.embed_content(
                model=model,
                contents=text
            )
            embeddings.append(result.embeddings[0].values)
            # Small delay every 10 calls to avoid Gemini rate limits
            if (i + 1) % 10 == 0:
                await asyncio.sleep(0.5)
        return embeddings

    async def _embed_bedrock(self, texts: List[str]) -> List[List[float]]:
        client = self._get_bedrock_client()
        embeddings = []
        for text in texts:
            body = json.dumps({"inputText": text[:8000]})
            resp = client.invoke_model(
                modelId=config.get('llm.embedding_model', 'amazon.titan-embed-text-v1'),
                body=body,
                contentType='application/json',
                accept='application/json'
            )
            result = json.loads(resp['body'].read())
            embeddings.append(result['embedding'])
        return embeddings


# ============================================================================
# LLM PROVIDER
# ============================================================================
class LLMProvider:

    def __init__(self):
        self.provider = config.get('llm.provider', 'openai')
        self._openai_client = None
        self._gemini_client = None
        self._bedrock_client = None

    async def chat(self, system_prompt: str, user_prompt: str) -> str:
        if self.provider == 'openai':
            return await self._chat_openai(system_prompt, user_prompt)
        elif self.provider == 'gemini':
            return await self._chat_gemini(system_prompt, user_prompt)
        elif self.provider == 'bedrock':
            return await self._chat_bedrock(system_prompt, user_prompt)
        else:
            raise ValueError(f"Unknown LLM provider: {self.provider}")

    async def _chat_openai(self, system_prompt: str, user_prompt: str) -> str:
        if not self._openai_client:
            from openai import AsyncOpenAI
            self._openai_client = AsyncOpenAI(api_key=os.getenv('OPENAI_API_KEY'))
        response = await self._openai_client.chat.completions.create(
            model=config.get('llm.chat_model', 'gpt-4o'),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=config.get('llm.temperature', 0),
            max_tokens=config.get('llm.max_tokens', 2048),
            response_format={"type": "json_object"}
        )
        return response.choices[0].message.content

    async def _chat_gemini(self, system_prompt: str, user_prompt: str) -> str:
        # Uses google.genai.Client — matches ingestion_pipeline.py style
        if not self._gemini_client:
            from google import genai
            from google.genai import types
            self._gemini_client = genai.Client(api_key=os.getenv('GEMINI_API_KEY'))
        import re
        from google.genai import types
        model_name ='gemini-2.5-flash-lite'
        full_prompt = (
            f"{system_prompt}\n\n"
            f"{user_prompt}\n\n"
            f"IMPORTANT: Respond ONLY with a valid JSON object, no markdown."
        )
        max_retries = 4
        for attempt in range(max_retries):
            try:
                response = self._gemini_client.models.generate_content(
                    model=model_name,
                    contents=full_prompt,
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        temperature=config.get('llm.temperature', 0),
                        max_output_tokens=config.get('llm.max_tokens', 2048)
                    )
                )
                return response.text
            except Exception as e:
                err = str(e)
                if '429' in err or 'RESOURCE_EXHAUSTED' in err:
                    match = re.search(r'retry.*?(\d+)s', err, re.IGNORECASE)
                    wait = int(match.group(1)) + 2 if match else 15 * (attempt + 1)
                    logger.warning(f"  Gemini 429 — waiting {wait}s (attempt {attempt+1}/{max_retries})")
                    await asyncio.sleep(wait)
                else:
                    raise
        raise RuntimeError(f"Gemini chat failed after {max_retries} retries")

    async def _chat_bedrock(self, system_prompt: str, user_prompt: str) -> str:
        if not self._bedrock_client:
            self._bedrock_client = boto3.client(
                'bedrock-runtime',
                region_name=config.get('aws.region', 'us-east-1')
            )
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": config.get('llm.max_tokens', 2048),
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}]
        })
        response = self._bedrock_client.invoke_model(
            modelId=config.get('llm.chat_model', 'anthropic.claude-3-sonnet-20240229-v1:0'),
            body=body,
            contentType='application/json',
            accept='application/json'
        )
        result = json.loads(response['body'].read())
        return result['content'][0]['text']

    def parse_json_response(self, text: str) -> Dict:
        text = text.strip()
        # Strip optional language tag after opening fence (e.g. ```json or ```)
        if text.startswith('```'):
            # remove opening fence line
            first_newline = text.find('\n')
            if first_newline != -1:
                text = text[first_newline + 1:]
            else:
                text = text[3:]
        if text.endswith('```'):
            text = text[:-3]
        text = text.strip()
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            logger.warning("JSON parse failed — returning raw text")
            return {"answer": text, "score": 0, "key_points": []}


# ============================================================================
# VECTOR RETRIEVER
# Mirrors ingestion_pipeline.py VectorStoreProvider._get_chroma_client /
# _get_chroma_collection pattern exactly (recreate=False for reads).
# ============================================================================
class VectorRetriever:

    def __init__(self):
        self.embedder = EmbeddingProvider()
        self.store_type = config.get('vector_store.type', 'chroma')
        self._chroma_client = None          # single shared client
        self._opensearch_client = None

    # ── ChromaDB helpers — match ingestion_pipeline.py exactly ───────────────
    def _get_chroma_client(self):
        if not self._chroma_client:
            import chromadb
            persist_dir = config.get('vector_store.chroma_persist_dir', './chroma_db')
            self._chroma_client = chromadb.PersistentClient(path=persist_dir)
        return self._chroma_client

    def _get_chroma_collection(self, index_name: str, embedding_dim: int, recreate: bool = False):
        """
        Open a Chroma collection for querying.
        Never passes `dimension` in metadata — the dimension is locked when the
        collection is first created during ingestion. Passing a different value
        here raises InvalidArgumentError even though we're just reading.
        recreate=False always for retrieval (never drop on reads).
        """
        client = self._get_chroma_client()
        if recreate:
            try:
                client.delete_collection(name=index_name)
                logger.info(f"  ChromaDB: Dropped stale collection '{index_name}'")
            except Exception:
                pass
            return client.create_collection(
                name=index_name,
                metadata={"hnsw:space": "cosine", "dimension": embedding_dim}
            )
        # For reads: get_or_create without dimension to avoid mismatch errors
        return client.get_or_create_collection(
            name=index_name,
            metadata={"hnsw:space": "cosine"}
        )

    async def _retrieve_chroma(
        self,
        index_name: str,
        query_embedding: List[float],
        k: int,
        filter_conditions: Dict = None
    ) -> List[Dict]:
        embedding_dim = len(query_embedding)
        col = self._get_chroma_collection(index_name, embedding_dim, recreate=False)

        count = col.count()
        if count == 0:
            logger.warning(f"  Collection '{index_name}' is empty")
            return []

        where = self._build_chroma_filter(filter_conditions) if filter_conditions else None

        kwargs = dict(
            query_embeddings=[query_embedding],
            n_results=min(k, count),
            include=['documents', 'metadatas', 'distances']
        )
        if where:
            kwargs['where'] = where

        results = col.query(**kwargs)

        docs = []
        for doc, meta, dist in zip(
            results['documents'][0],
            results['metadatas'][0],
            results['distances'][0]
        ):
            docs.append({
                'content': doc,
                'metadata': meta,
                'score': 1 - dist  # cosine distance → similarity
            })
        return docs

    def _build_chroma_filter(self, conditions: Dict) -> Optional[Dict]:
        if not conditions:
            return None
        filters = []
        for field, value in conditions.items():
            if isinstance(value, list):
                filters.append({field: {"$in": value}})
            else:
                filters.append({field: {"$eq": str(value)}})
        if len(filters) == 1:
            return filters[0]
        return {"$and": filters} if filters else None

    # ── OpenSearch ────────────────────────────────────────────────────────────
    def _get_opensearch_client(self):
        if not self._opensearch_client:
            from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth
            host = config.get('vector_store.opensearch_host', '')
            region = config.get('aws.region', 'us-east-1')
            credentials = boto3.Session().get_credentials()
            auth = AWSV4SignerAuth(credentials, region, 'aoss')
            self._opensearch_client = OpenSearch(
                hosts=[{'host': host, 'port': 443}],
                http_auth=auth,
                use_ssl=True,
                verify_certs=True,
                connection_class=RequestsHttpConnection,
                timeout=30
            )
        return self._opensearch_client

    async def _retrieve_opensearch(
        self,
        index_name: str,
        query_embedding: List[float],
        k: int,
        filter_conditions: Dict = None
    ) -> List[Dict]:
        client = self._get_opensearch_client()
        search_body = {
            "size": k,
            "query": {
                "bool": {
                    "must": [{"knn": {"vector_field": {"vector": query_embedding, "k": k}}}]
                }
            }
        }
        if filter_conditions:
            search_body["query"]["bool"]["filter"] = [
                {"match": {fk: fv}} for fk, fv in filter_conditions.items()
            ]
        response = client.search(index=index_name, body=search_body)
        return [
            {
                'content': hit['_source'].get('text', ''),
                'metadata': hit['_source'],
                'score': hit['_score']
            }
            for hit in response['hits']['hits']
        ]

    # ── Public interface ──────────────────────────────────────────────────────
    async def retrieve(
        self,
        index_name: str,
        query: str,
        k: int = 10,
        filter_conditions: Dict = None
    ) -> List[Dict]:
        logger.info(f"  Retrieving from '{index_name}' k={k} | query: {query[:60]}...")
        query_embedding = await self.embedder.embed_query(query)
        if self.store_type == 'chroma':
            docs = await self._retrieve_chroma(index_name, query_embedding, k, filter_conditions)
        else:
            docs = await self._retrieve_opensearch(index_name, query_embedding, k, filter_conditions)
        logger.info(f"  Retrieved {len(docs)} docs from '{index_name}'")
        return docs


# ============================================================================
# DOCUMENT POST-PROCESSOR
# ============================================================================
class DocumentPostProcessor:

    def __init__(self):
        self._reranker = None
        self._reranker_tokenizer = None

    def deduplicate(self, docs: List[Dict]) -> List[Dict]:
        seen = {}
        for doc in docs:
            key = doc['content'].strip()
            if key not in seen:
                seen[key] = doc
        return list(seen.values())

    def rerank(self, docs: List[Dict], query: str, top_k: int = 5) -> List[Dict]:
        if len(docs) <= top_k:
            return docs
        reranker_path = config.get('retriever.reranker_path', '')
        if not reranker_path or not os.path.exists(reranker_path):
            logger.debug("Reranker path not set or missing — skipping rerank")
            return docs[:top_k]
        try:
            if not self._reranker:
                from transformers import AutoTokenizer, AutoModelForSequenceClassification
                import torch
                self._reranker_tokenizer = AutoTokenizer.from_pretrained(reranker_path)
                self._reranker = AutoModelForSequenceClassification.from_pretrained(reranker_path)
                logger.info(f"Reranker loaded from {reranker_path}")
            import torch
            pairs = [[query, d['content']] for d in docs]
            with torch.no_grad():
                inputs = self._reranker_tokenizer(
                    pairs, padding=True, truncation=True, return_tensors="pt"
                )
                scores = self._reranker(**inputs).logits.view(-1).float().numpy()
            ranked = sorted(zip(scores, docs), key=lambda x: x[0], reverse=True)
            return [d for _, d in ranked[:top_k]]
        except Exception as e:
            logger.warning(f"Reranking failed: {e} — falling back to top-k by score")
            return sorted(docs, key=lambda x: x.get('score', 0), reverse=True)[:top_k]

    def build_context(self, docs: List[Dict], source_label: str) -> str:
        if not docs:
            return f"No relevant {source_label} documents found."
        parts = []
        for i, doc in enumerate(docs, 1):
            meta = doc.get('metadata', {})
            meta_lines = []
            for field in [
                'scheme_name', 'scheme_type', 'ministry', 'state',
                'beneficiary', 'annual_benefit', 'content_type',
                'file_name', 'page_number', 'keywords'
            ]:
                val = meta.get(field)
                if val and str(val).strip():
                    meta_lines.append(f"{field.replace('_', ' ').title()}: {val}")
            meta_block = "\n".join(meta_lines)
            parts.append(
                f"[Document {i}]\n"
                f"{meta_block}\n\n"
                f"Content:\n{doc['content']}"
            )
        return "\n\n" + ("─" * 60) + "\n\n".join(parts)


# ============================================================================
# PROMPTS
# ============================================================================
SCHEME_PROMPT_SYSTEM = """You are an expert on Indian Government Schemes.
You help citizens understand official scheme guidelines accurately.
Always respond in valid JSON only."""

SCHEME_PROMPT_USER = """Based on the official scheme documentation below, answer the question.

OFFICIAL SCHEME DOCUMENTS:
{context}

QUESTION: {question}

Respond in this exact JSON format:
{{
  "answer": "detailed answer based on official documents",
  "scheme_names": ["list of schemes mentioned"],
  "eligibility_summary": "who is eligible",
  "key_benefits": ["benefit 1", "benefit 2"],
  "sources": ["file_name:page_number pairs"]
}}"""

CITIZEN_PROMPT_SYSTEM = """You are a citizen services advisor specializing in Indian Government Schemes.
You understand common questions, confusions, and practical difficulties citizens face.
Always respond in valid JSON only."""

CITIZEN_PROMPT_USER = """Based on citizen FAQs and common queries below, understand what citizens typically ask about this topic.

CITIZEN FAQ DOCUMENTS:
{context}

CURRENT QUESTION: {question}

Respond in this exact JSON format:
{{
  "answer": "answer addressing common citizen concerns",
  "common_confusions": ["confusion 1", "confusion 2"],
  "practical_tips": ["tip 1", "tip 2"],
  "related_questions": ["related question 1", "related question 2"]
}}"""

SYNTHESIS_PROMPT_SYSTEM = """You are a knowledgeable and empathetic Government Scheme advisor for Indian citizens.
Your role is to give a complete, accurate, and easy-to-understand answer by combining:
1. Official scheme information (what the government officially offers)
2. Citizen perspective (practical guidance, common issues, tips)

Always respond in valid JSON only."""

SYNTHESIS_PROMPT_USER = """Synthesize a comprehensive answer for the citizen's question.

CITIZEN'S QUESTION: {question}

OFFICIAL SCHEME INFORMATION:
{scheme_answer}

CITIZEN FAQ CONTEXT:
{citizen_answer}

Respond in this exact JSON format:
{{
  "final_answer": "comprehensive, citizen-friendly answer combining both sources",
  "eligibility": "who qualifies and how to check",
  "benefits": ["specific benefit 1", "specific benefit 2"],
  "how_to_apply": ["step 1", "step 2", "step 3"],
  "documents_required": ["document 1", "document 2"],
  "practical_tips": ["tip 1", "tip 2"],
  "helpline": "relevant helpline number or website if available",
  "schemes_covered": ["scheme name 1"],
  "confidence_score": 0.0
}}"""


# ============================================================================
# DUAL RAG PROCESSOR
# ============================================================================
class DualRAGProcessor:
    """
    Core Dual RAG execution engine.

    Flow per query:
      1. Retrieve from schemes_index        (official guidelines)
      2. Retrieve from citizen_faq_index    (FAQs, common questions)
      3. LLM call 1: scheme answer
      4. LLM call 2: citizen context answer
      5. LLM call 3: synthesis → final answer
    """

    def __init__(self):
        self.retriever = VectorRetriever()
        self.post_processor = DocumentPostProcessor()
        self.llm = LLMProvider()

    async def query(self, request: Dict) -> Dict:
        """
        Input:
        {
            "question": "Am I eligible for Ayushman Bharat if I earn 2 lakh per year?",
            "filters": {
                "schemes_index":      {"scheme_type": "health"},
                "citizen_faq_index":  {"scheme_type": "health"}
            },
            "options": {"k": 8, "rerank": false, "rerank_top_k": 5}
        }
        """
        interaction_id = str(uuid4())
        start = time.perf_counter()

        logger.info("=" * 70)
        logger.info(f"DUAL RAG QUERY — ID: {interaction_id}")
        logger.info(f"Question: {request['question']}")
        logger.info("=" * 70)

        question = request['question']
        filters = request.get('filters', {})
        options = request.get('options', {})
        k = options.get('k', config.get('retriever.k', 8))
        do_rerank = options.get('rerank', config.get('retriever.enable_reranker', False))
        rerank_top_k = options.get('rerank_top_k', config.get('retriever.rerank_top_k', 5))

        schemes_index = config.get('indices.schemes_index', 'schemes_index')
        citizen_index = config.get('indices.citizen_faq_index', 'citizen_faq_index')

        # ── STEP 1 & 2: RETRIEVE ─────────────────────────────────────────────
        logger.info("\n[STEP 1] Retrieving from schemes_index...")
        scheme_docs = await self.retriever.retrieve(
            index_name=schemes_index,
            query=question,
            k=k,
            filter_conditions=filters.get('schemes_index')
        )

        logger.info("\n[STEP 2] Retrieving from citizen_faq_index...")
        citizen_docs = await self.retriever.retrieve(
            index_name=citizen_index,
            query=question,
            k=k,
            filter_conditions=filters.get('citizen_faq_index')
        )

        # ── POST-PROCESS ─────────────────────────────────────────────────────
        scheme_docs = self.post_processor.deduplicate(scheme_docs)
        citizen_docs = self.post_processor.deduplicate(citizen_docs)

        if do_rerank:
            logger.info("  Reranking documents...")
            scheme_docs = self.post_processor.rerank(scheme_docs, question, rerank_top_k)
            citizen_docs = self.post_processor.rerank(citizen_docs, question, rerank_top_k)

        scheme_context = self.post_processor.build_context(scheme_docs, "scheme")
        citizen_context = self.post_processor.build_context(citizen_docs, "citizen FAQ")

        # ── STEP 3: SCHEME ANSWER ────────────────────────────────────────────
        logger.info("\n[STEP 3] Generating scheme answer...")
        scheme_raw = await self.llm.chat(
            system_prompt=SCHEME_PROMPT_SYSTEM,
            user_prompt=SCHEME_PROMPT_USER.format(context=scheme_context, question=question)
        )
        scheme_answer = self.llm.parse_json_response(scheme_raw)
        logger.info(f"  Scheme answer: {str(scheme_answer.get('answer', ''))[:120]}...")

        # ── STEP 4: CITIZEN ANSWER ───────────────────────────────────────────
        # Skip if citizen index is empty (FAQs not yet ingested) — synthesise
        # from scheme data alone rather than crashing or hallucinating.
        if citizen_docs:
            logger.info("\n[STEP 4] Generating citizen context answer...")
            citizen_raw = await self.llm.chat(
                system_prompt=CITIZEN_PROMPT_SYSTEM,
                user_prompt=CITIZEN_PROMPT_USER.format(context=citizen_context, question=question)
            )
            citizen_answer = self.llm.parse_json_response(citizen_raw)
            logger.info(f"  Citizen answer: {str(citizen_answer.get('answer', ''))[:120]}...")
        else:
            logger.warning(
                "\n[STEP 4] ⚠ citizen_faq_index is empty — skipping citizen LLM call.\n"
                "  To populate it:  python ingestion.py input_faqs.json\n"
                "  (place PDF files in data/faqs/ first)"
            )
            citizen_answer = {
                "answer": "No citizen FAQ data available yet. Please ingest FAQ documents.",
                "common_confusions": [],
                "practical_tips": [],
                "related_questions": []
            }

        # ── STEP 5: SYNTHESIS ────────────────────────────────────────────────
        logger.info("\n[STEP 5] Synthesizing final answer...")
        final_raw = await self.llm.chat(
            system_prompt=SYNTHESIS_PROMPT_SYSTEM,
            user_prompt=SYNTHESIS_PROMPT_USER.format(
                question=question,
                scheme_answer=json.dumps(scheme_answer, ensure_ascii=False),
                citizen_answer=json.dumps(citizen_answer, ensure_ascii=False)
            )
        )
        final_answer = self.llm.parse_json_response(final_raw)

        elapsed = time.perf_counter() - start
        logger.info(f"\n✓ Query complete in {elapsed:.2f}s")
        logger.info("=" * 70)

        return {
            'interaction_id': interaction_id,
            'question': question,
            **final_answer,
            'intermediate': {
                'scheme_answer': scheme_answer,
                'citizen_answer': citizen_answer,
                'scheme_docs_retrieved': len(scheme_docs),
                'citizen_docs_retrieved': len(citizen_docs),
                'processing_time_seconds': round(elapsed, 2)
            }
        }

    async def batch_query(self, requests: List[Dict]) -> List[Dict]:
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
# INDEX STATS HELPER
# Replicates ingestion_pipeline.py VectorStoreProvider.chroma_count
# without importing the ingestion module (avoids circular deps)
# ============================================================================
def _chroma_count(index_name: str) -> int:
    import chromadb
    persist_dir = config.get('vector_store.chroma_persist_dir', './chroma_db')
    client = chromadb.PersistentClient(path=persist_dir)
    # embedding_dim irrelevant for count — use get_or_create with placeholder
    col = client.get_or_create_collection(name=index_name)
    return col.count()


def _opensearch_count(index_name: str) -> int:
    from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth
    host = config.get('vector_store.opensearch_host', '')
    region = config.get('aws.region', 'us-east-1')
    credentials = boto3.Session().get_credentials()
    auth = AWSV4SignerAuth(credentials, region, 'aoss')
    client = OpenSearch(
        hosts=[{'host': host, 'port': 443}],
        http_auth=auth, use_ssl=True, verify_certs=True,
        connection_class=RequestsHttpConnection, timeout=30
    )
    resp = client.count(index=index_name, body={"query": {"match_all": {}}})
    return resp['count']


# ============================================================================
# FASTAPI APPLICATION
# ============================================================================
app = FastAPI(
    title="Government Schemes Dual RAG API",
    description="Query Indian government schemes using dual-index RAG",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

processor = DualRAGProcessor()


@app.post("/api/query")
async def query_scheme(request: Request):
    """
    Query the Dual RAG system for government scheme information.

    Example request:
    {
        "question": "How do I apply for Ayushman Bharat card? What documents do I need?",
        "filters": {"schemes_index": {"scheme_type": "health"}},
        "options": {"k": 8, "rerank": false}
    }
    """
    body = await request.json()
    if not body.get('question'):
        return {"error": "question is required"}
    return await processor.query(body)


@app.post("/api/batch-query")
async def batch_query_schemes(request: Request):
    """Process multiple questions in batch. Request: {"queries": [{"question": "..."}, ...]}"""
    body = await request.json()
    queries = body.get('queries', [])
    if not queries:
        return {"error": "queries list is required"}
    results = await processor.batch_query(queries)
    return {"results": results, "total": len(results)}


@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "llm_provider": config.get('llm.provider', 'openai'),
        "vector_store": config.get('vector_store.type', 'chroma'),
        "schemes_index": config.get('indices.schemes_index', 'schemes_index'),
        "citizen_faq_index": config.get('indices.citizen_faq_index', 'citizen_faq_index')
    }


@app.get("/api/indexes/stats")
async def index_stats():
    """Show document counts for both indexes"""
    store_type = config.get('vector_store.type', 'chroma')
    schemes_idx = config.get('indices.schemes_index', 'schemes_index')
    citizen_idx = config.get('indices.citizen_faq_index', 'citizen_faq_index')

    stats = {}
    try:
        if store_type == 'chroma':
            stats['schemes_index_count'] = _chroma_count(schemes_idx)
            stats['citizen_faq_index_count'] = _chroma_count(citizen_idx)
        else:
            stats['schemes_index_count'] = _opensearch_count(schemes_idx)
            stats['citizen_faq_index_count'] = _opensearch_count(citizen_idx)
    except Exception as e:
        stats['error'] = str(e)

    return stats


# ============================================================================
# CLI ENTRY POINT
# ============================================================================
async def main():
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

    p = DualRAGProcessor()

    for i, query in enumerate(demo_queries, 1):
        print(f"\n{'=' * 70}")
        print(f"QUERY {i}: {query['question']}")
        print('=' * 70)

        result = await p.query(query)

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
        uvicorn.run("execution:app", host="0.0.0.0", port=port, reload=False)
    else:
        asyncio.run(main())