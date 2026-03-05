"""
Government Schemes Dual RAG - Ingestion Pipeline
=================================================
Complete 6-Step Pipeline: Extract → Chunk → Enrich → Embed → Store → Validate

TWO INDEXES:
  1. schemes_index    → Official scheme details (eligibility, benefits, process, documents)
  2. citizen_faq_index → Citizen questions, FAQs, feedback mapped to schemes

LLM PROVIDER: Configurable via config.json
  - "openai"   → OpenAI API (gpt-4o, text-embedding-3-small)
  - "gemini"   → Google Gemini (gemini-2.5-flash + gemini-embedding-001)
  - "bedrock"  → AWS Bedrock (claude-3/titan-embed) [production]

Vector Store: AWS OpenSearch Serverless (free tier / bedrock-compatible)
              OR ChromaDB (fully local, zero cost)
"""

import os

from dotenv import load_dotenv
# Load .env relative to this file's directory, not cwd.
# This ensures `python /some/path/ingestion.py` always finds the right .env.
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'))

import json
import asyncio
import logging
import time
import tempfile
from typing import Dict, List, Any, Optional, Tuple
from uuid import uuid4
from pathlib import Path

import boto3
import numpy as np

# PDF Processing
import fitz  # PyMuPDF

# LangChain
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
import tiktoken

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


# ============================================================================
# CONFIGURATION MANAGER
# ============================================================================
class ConfigManager:
    """
    Load configuration from config.json
    Supports dot-notation key access: config.get('llm.provider')
    """

    def __init__(self):
        self.config = self._load_config()
        self.env = os.getenv('APP_ENV', 'local')
        logger.info(f"Config loaded. LLM provider: {self.get('llm.provider', 'openai')} | Env: {self.env}")

    def _load_config(self) -> Dict:
        config_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')
        if os.path.exists(config_path):
            with open(config_path, 'r') as f:
                return json.load(f)
        logger.warning(f"config.json not found at {config_path} — using defaults")
        return {}

    def get(self, key: str, default=None):
        keys = key.split('.')
        value = self.config
        for k in keys:
            if isinstance(value, dict):
                value = value.get(k)
                if value is None:
                    return default
            else:
                return default
        return value if value is not None else default


config = ConfigManager()


# ============================================================================
# EMBEDDING PROVIDER (Pluggable: OpenAI / Gemini / AWS Bedrock)
# ============================================================================
# ============================================================================
# EMBEDDING PROVIDER WITH AUTO FALLBACK
# ============================================================================
class EmbeddingProvider:

    def __init__(self):
        self.provider = config.get('llm.provider', 'openai')
        self._client = None
        self._bedrock_client = None
        self._local_model = None

    # ------------------------------------------------
    # Local Open Source Model
    # ------------------------------------------------
    def _get_local_model(self):
        if not self._local_model:
            from sentence_transformers import SentenceTransformer

            model_name = config.get(
                "llm.fallback_embedding_model",
                "BAAI/bge-small-en-v1.5"
            )

            logger.warning(
                f"⚠ Falling back to OPEN SOURCE embeddings: {model_name}"
            )

            self._local_model = SentenceTransformer(model_name)

        return self._local_model

    async def _embed_local(self, texts: List[str]) -> List[List[float]]:

        model = self._get_local_model()

        vectors = model.encode(
            texts,
            normalize_embeddings=True,
            show_progress_bar=False
        )

        return vectors.tolist()

    # ------------------------------------------------
    # Provider clients
    # ------------------------------------------------
    def _get_openai_client(self):
        if not self._client:
            from openai import OpenAI
            self._client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        return self._client

    def _get_gemini_client(self):
        if not self._client:
            from google import genai
            self._client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
        return self._client

    def _get_bedrock_client(self):
        if not self._bedrock_client:
            self._bedrock_client = boto3.client(
                "bedrock-runtime",
                region_name=config.get("aws.region", "us-east-1")
            )
        return self._bedrock_client

    # ------------------------------------------------
    # MAIN ENTRY
    # ------------------------------------------------
    async def embed_texts(self, texts: List[str]) -> List[List[float]]:

        try:

            if self.provider == "openai":
                logger.info("Generating embeddings via OpenAI")
                return await self._embed_openai(texts)

            elif self.provider == "gemini":
                logger.info("Generating embeddings via Gemini")
                return await self._embed_gemini(texts)

            elif self.provider == "bedrock":
                logger.info("Generating embeddings via Bedrock")
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

    # ------------------------------------------------
    # OpenAI
    # ------------------------------------------------
    async def _embed_openai(self, texts: List[str]):

        client = self._get_openai_client()

        response = client.embeddings.create(
            input=texts,
            model=config.get("llm.embedding_model", "text-embedding-3-small")
        )

        return [item.embedding for item in response.data]

    # ------------------------------------------------
    # Gemini
    # ------------------------------------------------
    async def _embed_gemini(self, texts: List[str]):
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

    # ------------------------------------------------
    # Bedrock
    # ------------------------------------------------
    async def _embed_bedrock(self, texts: List[str]):

        client = self._get_bedrock_client()

        embeddings = []

        for text in texts:

            body = json.dumps({"inputText": text[:8000]})

            response = client.invoke_model(
                modelId=config.get(
                    "llm.embedding_model",
                    "amazon.titan-embed-text-v1"
                ),
                body=body,
                contentType="application/json",
                accept="application/json"
            )

            result = json.loads(response["body"].read())

            embeddings.append(result["embedding"])

        return embeddings


# ============================================================================
# VECTOR STORE PROVIDER (ChromaDB local OR OpenSearch)
# ============================================================================
class VectorStoreProvider:
    """
    Pluggable vector store:
      - chroma     : Local ChromaDB (zero infra, perfect for development)
      - opensearch : AWS OpenSearch Serverless (production)
    """

    def __init__(self):
        self.store_type = config.get('vector_store.type', 'chroma')

    # -------------------------------------------------------------------------
    # ChromaDB
    # -------------------------------------------------------------------------
    def _get_chroma_client(self):
        import chromadb
        persist_dir = config.get("vector_store.chroma_persist_dir", "./chroma_db")
        return chromadb.PersistentClient(path=persist_dir)

    def _get_chroma_collection(self, index_name: str, embedding_dim: int, recreate: bool = False):
        client = self._get_chroma_client()
        if recreate:
            try:
                client.delete_collection(name=index_name)
                logger.info(f"  ChromaDB: Dropped stale collection '{index_name}'")
            except Exception:
                pass
            # Only set dimension metadata on fresh creation
            return client.create_collection(
                name=index_name,
                metadata={"hnsw:space": "cosine", "dimension": embedding_dim}
            )
        # For get_or_create (non-recreate), never pass dimension — it's
        # already locked in the persisted collection and passing a new value
        # raises InvalidArgumentError if it differs.
        return client.get_or_create_collection(
            name=index_name,
            metadata={"hnsw:space": "cosine"}
        )

    # FIX 1: Added embedding_dim parameter (defaulting to config value) so
    # _get_chroma_collection receives the required argument.
    def chroma_delete_by_field(
        self,
        index_name: str,
        field: str,
        value: str,
        embedding_dim: int = None
    ):
        dim = embedding_dim or config.get("llm.embedding_dimensions", 384)
        col = self._get_chroma_collection(index_name, dim)
        results = col.get(where={field: value})
        if results['ids']:
            col.delete(ids=results['ids'])
            logger.info(f"  ChromaDB: Deleted {len(results['ids'])} existing docs")

    # FIX 2: Actually upsert the embeddings/documents/metadatas into Chroma.
    # The original method retrieved the collection but never wrote anything.
    def chroma_upsert(
        self,
        index_name: str,
        chunks: List[Document],
        embeddings: List[List[float]]
    ) -> Dict:

        embedding_dim = len(embeddings[0])
        logger.info(f"Embedding dimension detected: {embedding_dim}")

        col = self._get_chroma_collection(index_name, embedding_dim, recreate=True)

        ids = [str(uuid4()) for _ in chunks]
        documents = [c.page_content for c in chunks]
        metadatas = []
        for c in chunks:
            meta = {}
            for k, v in c.metadata.items():
                if v is None:
                    meta[k] = ""
                elif isinstance(v, list):
                    meta[k] = ", ".join(str(x) for x in v)
                else:
                    meta[k] = v
            metadatas.append(meta)

        batch_size = 100
        success_count = 0
        error_count = 0

        for i in range(0, len(ids), batch_size):
            try:
                col.upsert(
                    ids=ids[i:i + batch_size],
                    embeddings=embeddings[i:i + batch_size],
                    documents=documents[i:i + batch_size],
                    metadatas=metadatas[i:i + batch_size],
                )
                success_count += len(ids[i:i + batch_size])
            except Exception as e:
                logger.error(f"  ChromaDB upsert batch {i} failed: {e}")
                error_count += len(ids[i:i + batch_size])

        return {'success': success_count > 0, 'inserted': success_count, 'failed': error_count}

    def chroma_count(self, index_name: str, field: str = None, value: str = None) -> int:
        dim = config.get("llm.embedding_dimensions", 384)
        col = self._get_chroma_collection(index_name, dim)
        if field and value:
            results = col.get(where={field: value})
            return len(results['ids'])
        return col.count()

    # -------------------------------------------------------------------------
    # OpenSearch
    # -------------------------------------------------------------------------
    def _get_opensearch_client(self):
        from opensearchpy import OpenSearch, RequestsHttpConnection, AWSV4SignerAuth
        host = config.get('vector_store.opensearch_host', '')
        region = config.get('aws.region', 'us-east-1')
        credentials = boto3.Session().get_credentials()
        auth = AWSV4SignerAuth(credentials, region, 'aoss')
        return OpenSearch(
            hosts=[{'host': host, 'port': 443}],
            http_auth=auth,
            use_ssl=True,
            verify_certs=True,
            connection_class=RequestsHttpConnection,
            timeout=300
        )

    def opensearch_delete_by_field(self, index_name: str, field: str, value: str):
        client = self._get_opensearch_client()
        try:
            client.delete_by_query(
                index=index_name,
                body={"query": {"match": {field: value}}}
            )
        except Exception as e:
            logger.warning(f"  OpenSearch delete failed: {e}")

    def opensearch_bulk_insert(
        self,
        index_name: str,
        chunks: List[Document],
        embeddings: List[List[float]]
    ) -> Dict:
        client = self._get_opensearch_client()
        body = []
        for chunk, emb in zip(chunks, embeddings):
            body.append({'index': {'_index': index_name}})
            doc = {
                'vector_field': emb,
                'text': chunk.page_content,
            }
            for k, v in chunk.metadata.items():
                if v is None:
                    continue
                if isinstance(v, list):
                    doc[k] = ", ".join(str(x) for x in v)
                else:
                    doc[k] = v
            body.append(doc)

        batch_size = 50
        success_count, error_count = 0, 0

        for i in range(0, len(body), batch_size * 2):
            batch = body[i:i + batch_size * 2]
            resp = client.bulk(body=batch)
            if resp.get('errors'):
                for item in resp.get('items', []):
                    result = item.get('index', {})
                    if result.get('status') in [200, 201]:
                        success_count += 1
                    else:
                        error_count += 1
            else:
                success_count += len(batch) // 2

        return {'success': success_count > 0, 'inserted': success_count, 'failed': error_count}

    def opensearch_count(self, index_name: str, field: str = None, value: str = None) -> int:
        client = self._get_opensearch_client()
        try:
            if field and value:
                query = {"query": {"term": {f"{field}.keyword": value}}}
            else:
                query = {"query": {"match_all": {}}}
            response = client.count(index=index_name, body=query)
            return response['count']
        except Exception as e:
            logger.warning(f"  OpenSearch count failed: {e}")
            return 0


# ============================================================================
# STEP 1: PDF EXTRACTOR
# ============================================================================
class PDFExtractor:
    """Extract structured text from PDF using PyMuPDF"""

    async def extract(self, file_path: str) -> List[Dict]:
        start = time.perf_counter()
        base_name = Path(file_path).name
        logger.info(f"[STEP 1] PDF EXTRACTION — {base_name}")

        doc = fitz.open(file_path, filetype="pdf")
        pages_data = []

        for page_num, page in enumerate(doc):
            page_dict = page.get_text("dict", sort=True)
            pages_data.append(page_dict)

        doc.close()
        logger.info(f"[STEP 1] ✓ Extracted {len(pages_data)} pages in {time.perf_counter()-start:.2f}s")

        return [{"docs": pages_data, "file_name": base_name}]

    def _extract_page_text(self, page_dict: Dict) -> str:
        parts = []
        for block in page_dict.get('blocks', []):
            if block.get('type') == 0:
                for line in block.get('lines', []):
                    line_text = "".join(span.get('text', '') for span in line.get('spans', []))
                    if line_text.strip():
                        parts.append(line_text.strip())
        return '\n'.join(parts)


# ============================================================================
# STEP 2: CHUNKING SERVICE
# ============================================================================
class ChunkingService:
    """Token-aware recursive text splitter"""

    def __init__(self):
        self.extractor = PDFExtractor()

    async def chunk(
        self,
        extracted_text: List[Dict],
        chunk_size: int = 256,
        chunk_overlap: int = 64,
        extra_metadata: Dict = None
    ) -> List[Document]:
        start = time.perf_counter()
        logger.info(f"[STEP 2] CHUNKING — size={chunk_size}, overlap={chunk_overlap}")

        splitter = RecursiveCharacterTextSplitter.from_tiktoken_encoder(
            model_name="gpt-3.5-turbo",
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            separators=["\n\n", "\n", ".", " ", ""]
        )

        all_chunks = []

        for doc_data in extracted_text:
            file_name = doc_data['file_name']
            pages = doc_data['docs']

            for page_num, page_dict in enumerate(pages):
                page_text = self.extractor._extract_page_text(page_dict)
                if not page_text.strip():
                    continue

                for chunk_idx, text in enumerate(splitter.split_text(page_text)):
                    meta = {
                        'file_name': file_name,
                        'page_number': page_num + 1,
                        'chunk_index': chunk_idx,
                    }
                    if extra_metadata:
                        meta.update(extra_metadata)

                    all_chunks.append(Document(page_content=text, metadata=meta))

        logger.info(f"[STEP 2] ✓ Created {len(all_chunks)} chunks in {time.perf_counter()-start:.2f}s")
        return all_chunks


# ============================================================================
# STEP 3: METADATA ENRICHER
# ============================================================================
class MetadataEnricher:
    """
    Enrich chunks with:
    - scheme_name   : extracted from filename / config
    - scheme_type   : PM scheme, State scheme, Health, Agriculture, etc.
    - keywords      : RAKE-based keyword extraction
    - named_entities: spaCy NER (PERSON, ORG, GPE, LAW)
    """

    def __init__(self):
        self._rake = None
        self._nlp = None

    async def enrich(self, chunks: List[Document]) -> List[Document]:
        start = time.perf_counter()
        logger.info(f"[STEP 3] METADATA ENRICHMENT — {len(chunks)} chunks")

        enable_ner = config.get('enrichment.enable_ner', True)
        enable_keywords = config.get('enrichment.enable_keywords', True)

        enriched = []
        for idx, chunk in enumerate(chunks):
            meta = chunk.metadata.copy()

            if enable_keywords:
                meta['keywords'] = self._extract_keywords(chunk.page_content)

            if enable_ner:
                meta['named_entities'] = self._extract_entities(chunk.page_content)

            enriched.append(Document(page_content=chunk.page_content, metadata=meta))

        logger.info(f"[STEP 3] ✓ Enriched {len(enriched)} chunks in {time.perf_counter()-start:.2f}s")
        return enriched

    def _extract_keywords(self, text: str) -> str:
        try:
            if not self._rake:
                from rake_nltk import Rake
                import nltk
                for resource in ['stopwords', 'punkt', 'punkt_tab']:
                    try:
                        nltk.data.find(f'tokenizers/{resource}' if 'punkt' in resource else f'corpora/{resource}')
                    except LookupError:
                        nltk.download(resource, quiet=True)
                self._rake = Rake()

            self._rake.extract_keywords_from_text(text[:5000])
            return ", ".join(self._rake.get_ranked_phrases()[:15])
        except Exception as e:
            logger.debug(f"Keyword extraction failed: {e}")
            return ""

    def _extract_entities(self, text: str) -> str:
        try:
            if not self._nlp:
                import spacy
                try:
                    self._nlp = spacy.load('en_core_web_sm')
                except OSError:
                    import subprocess
                    subprocess.run(['python', '-m', 'spacy', 'download', 'en_core_web_sm'], check=True)
                    self._nlp = spacy.load('en_core_web_sm')

            doc = self._nlp(text[:5000])
            entities = [
                f"{ent.text} ({ent.label_})"
                for ent in doc.ents
                if ent.label_ in ['ORG', 'GPE', 'PERSON', 'LAW', 'MONEY', 'PERCENT']
            ]
            return ", ".join(entities[:30])
        except Exception as e:
            logger.debug(f"NER extraction failed: {e}")
            return ""


# ============================================================================
# STEP 4: VECTOR STORAGE SERVICE
# ============================================================================
class VectorStorageService:
    """Generate embeddings and store in ChromaDB or OpenSearch"""

    def __init__(self):
        self.embedder = EmbeddingProvider()
        self.store = VectorStoreProvider()

    async def store_chunks(
        self,
        chunks: List[Document],
        index_name: str,
        delete_existing: bool = True,
        filter_field: str = 'document_name'
    ) -> Dict:
        start = time.perf_counter()
        store_type = config.get('vector_store.type', 'chroma')
        logger.info(f"[STEP 4] VECTOR STORAGE — index={index_name}, store={store_type}, chunks={len(chunks)}")

        # Step 4b: Embed first so we have the real dimension before delete
        logger.info(f"  Generating embeddings via {self.embedder.provider}...")
        embeddings = await self.embedder.embed_texts([c.page_content for c in chunks])
        embedding_dim = len(embeddings[0])

        # Step 4a: Delete existing (now we can pass the real embedding_dim)
        if delete_existing and chunks:
            val = chunks[0].metadata.get(filter_field, '')
            if val:
                if store_type == 'chroma':
                    self.store.chroma_delete_by_field(index_name, filter_field, val, embedding_dim)
                else:
                    self.store.opensearch_delete_by_field(index_name, filter_field, val)

        # Step 4c: Insert
        if store_type == 'chroma':
            result = self.store.chroma_upsert(index_name, chunks, embeddings)
        else:
            result = self.store.opensearch_bulk_insert(index_name, chunks, embeddings)

        logger.info(f"[STEP 4] ✓ Stored {result['inserted']} docs in {time.perf_counter()-start:.2f}s")
        return result


# ============================================================================
# STEP 5: VALIDATION SERVICE
# ============================================================================
class ValidationService:
    """Validate insertion with retry + exponential backoff"""

    async def validate(
        self,
        index_name: str,
        expected_count: int,
        filter_field: str = None,
        filter_value: str = None
    ) -> bool:
        store_type = config.get('vector_store.type', 'chroma')
        retry_count = config.get('validation.retry_count', 5)
        sleep_seconds = config.get('validation.sleep_seconds', 3)
        store = VectorStoreProvider()

        logger.info(f"[STEP 5] VALIDATION — expected={expected_count}, store={store_type}")

        for attempt in range(retry_count):
            try:
                if store_type == 'chroma':
                    actual = store.chroma_count(index_name, filter_field, filter_value)
                else:
                    actual = store.opensearch_count(index_name, filter_field, filter_value)

                logger.info(f"  Attempt {attempt+1}: found {actual}/{expected_count}")

                if actual >= expected_count:
                    logger.info(f"[STEP 5] ✓ Validation PASSED")
                    return True

            except Exception as e:
                logger.warning(f"  Validation attempt {attempt+1} failed: {e}")

            if attempt < retry_count - 1:
                wait = sleep_seconds * (attempt + 1)
                logger.info(f"  Retrying in {wait}s...")
                await asyncio.sleep(wait)

        logger.warning(f"[STEP 5] ✗ Validation FAILED after {retry_count} attempts")
        return False


# ============================================================================
# INGESTION PIPELINE ORCHESTRATOR
# ============================================================================
class IngestionPipeline:
    """
    Orchestrates full 5-step ingestion for Government Schemes Dual RAG.

    INDEX 1 — schemes_index:
        Official scheme documentation:
        - Full text of scheme guidelines
        - Eligibility criteria, benefits, application process
        - Required documents, deadlines, contact info
        Source: PDFs from govt websites (e.g., ayushman_bharat.pdf, pm_kisan.pdf)

    INDEX 2 — citizen_faq_index:
        Citizen-facing content:
        - FAQs published by ministries
        - Common questions, clarifications, grievance patterns
        - Simplified language guides
        Source: FAQ PDFs, citizen helpdesk documents

    The Dual RAG execution layer then:
        1. Searches citizen_faq_index for what citizens ask
        2. Searches schemes_index for official scheme details
        3. LLM synthesizes a final answer bridging both
    """

    def __init__(self):
        self.pdf_extractor = PDFExtractor()
        self.chunking_service = ChunkingService()
        self.metadata_enricher = MetadataEnricher()
        self.vector_storage = VectorStorageService()
        self.validation_service = ValidationService()

    async def ingest(self, request: Dict) -> Dict:
        """
        Main ingestion entry point.

        Input format:
        {
            "index_name": "schemes_index" | "citizen_faq_index",
            "documents": [
                {
                    "document_id": "doc-001",
                    "document_name": "ayushman_bharat.pdf",
                    "local_path": "data/schemes/ayushman_bharat.pdf",
                    "metadata": {
                        "scheme_name": "Ayushman Bharat",
                        "scheme_type": "health",
                        "ministry": "Ministry of Health",
                        "state": "Central",
                        "beneficiary": "BPL families",
                        "content_type": "official_guidelines"   <- for schemes_index
                                     OR "citizen_faq"           <- for citizen_faq_index
                    }
                }
            ],
            "options": {
                "delete_existing": true,
                "validate_after_insert": true,
                "chunk_size": 256,
                "chunk_overlap": 64
            }
        }
        """
        interaction_id = str(uuid4())
        logger.info("=" * 70)
        logger.info(f"INGESTION STARTED — ID: {interaction_id}")
        logger.info("=" * 70)

        index_name = config.get(f'indices.{request["index_name"]}', request['index_name'])
        logger.info(f"Index: {request['index_name']} → {index_name}")

        documents = request['documents']
        options = request.get('options', {})
        results = []

        for doc in documents:
            try:
                result = await self._process_document(doc, index_name, options)
                results.append(result)
            except Exception as e:
                logger.error(f"Document failed: {doc.get('document_name')} — {e}")
                results.append({
                    'document_id': doc.get('document_id'),
                    'document_name': doc.get('document_name'),
                    'status': 'failed',
                    'error': str(e)
                })

        success_count = sum(1 for r in results if r['status'] == 'success')
        logger.info("=" * 70)
        logger.info(f"INGESTION COMPLETE — {success_count}/{len(results)} succeeded")
        logger.info("=" * 70)

        return {
            'interaction_id': interaction_id,
            'index_name': index_name,
            'status': 'success' if success_count > 0 else 'failed',
            'results': results
        }

    async def _process_document(self, doc_config: Dict, index_name: str, options: Dict) -> Dict:
        """Process a single PDF document through the full pipeline"""
        document_id = doc_config['document_id']
        document_name = doc_config['document_name']
        metadata = doc_config.get('metadata', {})

        chunk_size = options.get('chunk_size', config.get('chunking.chunk_size', 256))
        chunk_overlap = options.get('chunk_overlap', config.get('chunking.chunk_overlap', 64))

        logger.info(f"\n► Processing: {document_name}")
        logger.info("-" * 60)

        # Resolve file path
        local_path = doc_config.get('local_path')
        if not local_path or not os.path.exists(local_path):
            raise FileNotFoundError(f"File not found: {local_path}")

        # STEP 1: Extract
        extracted_text = await self.pdf_extractor.extract(local_path)

        # STEP 2: Chunk (pass base metadata so every chunk gets it)
        base_meta = {
            'document_id': document_id,
            'document_name': document_name,
            **metadata
        }
        # Convert lists to strings for filter compatibility
        for k, v in base_meta.items():
            if isinstance(v, list):
                base_meta[k] = ", ".join(str(x) for x in v)

        chunks = await self.chunking_service.chunk(
            extracted_text,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            extra_metadata=base_meta
        )

        # STEP 3: Enrich
        enriched_chunks = await self.metadata_enricher.enrich(chunks)

        # STEP 4: Store vectors
        storage_result = await self.vector_storage.store_chunks(
            enriched_chunks,
            index_name,
            delete_existing=options.get('delete_existing', True),
            filter_field='document_name'
        )

        # STEP 5: Validate
        validation_passed = True
        if options.get('validate_after_insert', True) and storage_result['success']:
            validation_passed = await self.validation_service.validate(
                index_name,
                expected_count=storage_result['inserted'],
                filter_field='document_name',
                filter_value=document_name
            )

        logger.info(f"✓ Done: {document_name} | chunks={len(enriched_chunks)} | valid={validation_passed}")

        return {
            'document_id': document_id,
            'document_name': document_name,
            'status': 'success',
            'chunks_created': len(enriched_chunks),
            'chunks_inserted': storage_result['inserted'],
            'validation_passed': validation_passed
        }


# ============================================================================
# CLI ENTRY POINT
# ============================================================================
async def main():
    """
    CLI ingestion runner.
    Reads from input.json or uses defaults for testing.
    """
    import sys

    input_file = sys.argv[1] if len(sys.argv) > 1 else 'input.json'

    if os.path.exists(input_file):
        with open(input_file) as f:
            request = json.load(f)
        logger.info(f"Loaded ingestion request from {input_file}")
    else:
        # ── DEFAULT DEMO REQUEST ──────────────────────────────────────────────
        # Two batches to fill both indexes.
        # Run with index_name="schemes_index" first, then "citizen_faq_index"
        logger.info("No input.json found — using demo request (schemes_index)")
        request = {
            "index_name": "schemes_index",
            "documents": [
                {
                    "document_id": "ayushman-001",
                    "document_name": "ayushman_bharat.pdf",
                    "local_path": "data/schemes/ayushman_bharat.pdf",
                    "metadata": {
                        "scheme_name": "Ayushman Bharat PM-JAY",
                        "scheme_type": "health",
                        "ministry": "Ministry of Health and Family Welfare",
                        "state": "Central",
                        "beneficiary": "BPL families, SECC database families",
                        "annual_benefit": "5 lakh INR per family",
                        "content_type": "official_guidelines"
                    }
                },
                {
                    "document_id": "pmkisan-001",
                    "document_name": "pm_kisan_yojana.pdf",
                    "local_path": "data/schemes/pm_kisan_yojana.pdf",
                    "metadata": {
                        "scheme_name": "PM Kisan Samman Nidhi",
                        "scheme_type": "agriculture",
                        "ministry": "Ministry of Agriculture",
                        "state": "Central",
                        "beneficiary": "Small and marginal farmers",
                        "annual_benefit": "6000 INR per year",
                        "content_type": "official_guidelines"
                    }
                }
            ],
            "options": {
                "delete_existing": True,
                "validate_after_insert": True,
                "chunk_size": 256,
                "chunk_overlap": 64
            }
        }

    pipeline = IngestionPipeline()
    result = await pipeline.ingest(request)

    print("\n" + "=" * 70)
    print("INGESTION RESULT")
    print("=" * 70)
    print(json.dumps(result, indent=2, default=str))


if __name__ == "__main__":
    asyncio.run(main())