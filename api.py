"""
DualRAG FastAPI Backend — api.py
Place this file inside the dualrag/ folder (same level as execution.py and ingestion.py).

Start with:
    uvicorn api:app --host 0.0.0.0 --port 8080 --reload

It imports DualRAGProcessor from execution.py and IngestionPipeline from ingestion.py directly.
Hash-based caching is layered on top — no changes needed to your core files.
"""

import os
import json
import hashlib
import tempfile
import logging
from pathlib import Path
from typing import Optional
from uuid import uuid4

# ── Load .env from this directory before any pipeline imports ────────────────
from dotenv import load_dotenv
load_dotenv(dotenv_path=Path(__file__).parent / ".env")

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

# ── Import YOUR core pipeline classes directly ───────────────────────────────
from execution import DualRAGProcessor, config, _chroma_count, _opensearch_count
from ingestion import IngestionPipeline

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

# ── Cache directory (sibling to this file: dualrag/report_cache/) ────────────
CACHE_DIR = Path(__file__).parent / "report_cache"
CACHE_DIR.mkdir(exist_ok=True)

UPLOAD_DIR = Path(__file__).parent / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# ── Singletons — instantiated once at startup ────────────────────────────────
_processor = DualRAGProcessor()
_ingestion = IngestionPipeline()

# ════════════════════════════════════════════════════════════════════════════
# HASH HELPERS
# ════════════════════════════════════════════════════════════════════════════

def _hash(payload: dict) -> str:
    """Stable 16-char SHA-256 hex of any JSON-serialisable dict."""
    raw = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def query_hash(question: str, filters: dict, options: dict) -> str:
    return _hash({"question": question, "filters": filters, "options": options})


def ingest_hash(filename: str, index_name: str, doc_type: str, metadata: dict) -> str:
    return _hash({"filename": filename, "index_name": index_name,
                  "doc_type": doc_type, "metadata": metadata})


def _cache_path(key: str) -> Path:
    return CACHE_DIR / f"{key}.json"


def _load(key: str) -> Optional[dict]:
    p = _cache_path(key)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return None


def _save(key: str, data: dict):
    _cache_path(key).write_text(
        json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8"
    )


# ════════════════════════════════════════════════════════════════════════════
# FASTAPI APP
# ════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="DualRAG API",
    description="Dual-index RAG for Indian Government Schemes — hash-cached reports",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Health ────────────────────────────────────────────────────────────────────

@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "llm_provider": config.get("llm.provider", "openai"),
        "vector_store": config.get("vector_store.type", "chroma"),
        "schemes_index": config.get("indices.schemes_index", "schemes_index"),
        "citizen_faq_index": config.get("indices.citizen_faq_index", "citizen_faq_index"),
        "cache_dir": str(CACHE_DIR),
    }


# ── Index stats (delegates to execution.py helpers) ──────────────────────────

@app.get("/api/indexes/stats")
async def index_stats():
    store_type = config.get("vector_store.type", "chroma")
    s_idx = config.get("indices.schemes_index", "schemes_index")
    c_idx = config.get("indices.citizen_faq_index", "citizen_faq_index")
    try:
        if store_type == "chroma":
            return {
                "schemes_index_count": _chroma_count(s_idx),
                "citizen_faq_index_count": _chroma_count(c_idx),
            }
        return {
            "schemes_index_count": _opensearch_count(s_idx),
            "citizen_faq_index_count": _opensearch_count(c_idx),
        }
    except Exception as e:
        return {"schemes_index_count": 0, "citizen_faq_index_count": 0, "error": str(e)}


# ════════════════════════════════════════════════════════════════════════════
# REPORT — EXECUTION PAGE
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/report/check")
async def check_report(request: Request):
    """
    Check if a cached report exists for (question, filters, options).
    Returns { exists, hash_key, report? }
    The frontend uses this to decide whether to show cached data + regenerate popup,
    or run fresh.
    """
    body = await request.json()
    question = body.get("question", "").strip()
    if not question:
        raise HTTPException(400, "question is required")

    filters = body.get("filters", {})
    options = body.get("options", {})
    key = query_hash(question, filters, options)
    cached = _load(key)

    if cached:
        return {"exists": True, "hash_key": key, "report": cached}
    return {"exists": False, "hash_key": key}


@app.post("/api/report/execute")
async def execute_report(request: Request):
    """
    Run DualRAGProcessor.query().
    Uses cache unless force=true.

    Body: { question, filters?, options?, force? }

    Internally calls:
        DualRAGProcessor.query({
            "question": ...,
            "filters": { "schemes_index": {...}, "citizen_faq_index": {...} },
            "options": { "k": 8, "rerank": false }
        })
    which is the exact same dict your existing execution.py CLI uses.
    """
    body = await request.json()
    question = body.get("question", "").strip()
    if not question:
        raise HTTPException(400, "question is required")

    filters = body.get("filters", {})
    options = body.get("options", {})
    force   = body.get("force", False)

    key = query_hash(question, filters, options)

    # Serve from cache unless force=true
    if not force:
        cached = _load(key)
        if cached:
            return {**cached, "_cached": True, "hash_key": key}

    # Call DualRAGProcessor.query() — the core execution pipeline
    result = await _processor.query({
        "question": question,
        "filters": filters,
        "options": options,
    })

    result["hash_key"] = key
    _save(key, result)
    return {**result, "_cached": False, "hash_key": key}


# ════════════════════════════════════════════════════════════════════════════
# INGESTION PAGE
# ════════════════════════════════════════════════════════════════════════════

@app.post("/api/ingest/check")
async def check_ingestion(request: Request):
    """
    Check if a document with these exact settings was already ingested.
    Returns { exists, hash_key, result? }
    """
    body = await request.json()
    key = ingest_hash(
        body.get("filename", ""),
        body.get("index_name", ""),
        body.get("doc_type", ""),
        body.get("metadata", {}),
    )
    cached = _load(f"ingest_{key}")
    if cached:
        return {"exists": True, "hash_key": key, "result": cached}
    return {"exists": False, "hash_key": key}


@app.post("/api/ingest")
async def ingest_document(
    file: UploadFile = File(...),
    index_name: str = Form(...),
    document_type: str = Form("official_guidelines"),
    metadata_json: str = Form("{}"),
    force: str = Form("false"),
):
    """
    Ingest a PDF into the specified index via IngestionPipeline.ingest().
    Uses the same request format as input_schemes.json / input_faqs.json.

    FormData fields:
        file            — PDF file
        index_name      — "schemes_index" or "citizen_faq_index"
        document_type   — e.g. "official_guidelines", "citizen_faq"
        metadata_json   — JSON string with scheme_name, scheme_type, ministry, state, etc.
        force           — "true" to re-ingest even if cached
    """
    try:
        extra_meta: dict = json.loads(metadata_json)
    except Exception:
        extra_meta = {}

    force_bool = force.lower() == "true"
    filename   = file.filename or "unknown.pdf"
    key        = ingest_hash(filename, index_name, document_type, extra_meta)

    # Serve from cache unless force
    if not force_bool:
        cached = _load(f"ingest_{key}")
        if cached:
            return {**cached, "_cached": True, "hash_key": key}

    # Save the uploaded PDF into the correct data sub-folder
    subfolder = "faqs" if "faq" in index_name or "faq" in document_type else "schemes"
    dest_dir  = Path(__file__).parent / "data" / subfolder
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = dest_dir / filename
    dest.write_bytes(await file.read())
    logger.info(f"Saved upload → {dest}")

    # Build metadata exactly as input_schemes.json / input_faqs.json does
    base_meta = {
        "scheme_name":   extra_meta.get("scheme_name", filename.replace(".pdf", "").replace("_", " ").title()),
        "scheme_type":   extra_meta.get("scheme_type", "general"),
        "ministry":      extra_meta.get("ministry", ""),
        "state":         extra_meta.get("state", "Central"),
        "content_type":  document_type,
        **extra_meta,
    }

    # The exact request format IngestionPipeline.ingest() expects
    ingest_request = {
        "index_name": index_name,
        "documents": [
            {
                "document_id":   f"doc-{uuid4().hex[:8]}",
                "document_name": filename,
                "local_path":    str(dest),
                "metadata":      base_meta,
            }
        ],
        "options": {
            "delete_existing":      True,
            "validate_after_insert": True,
            "chunk_size":  256,
            "chunk_overlap": 64,
        },
    }

    # Call IngestionPipeline.ingest() — the core ingestion pipeline
    result = await _ingestion.ingest(ingest_request)
    result["hash_key"] = key
    _save(f"ingest_{key}", result)
    return {**result, "_cached": False, "hash_key": key}


# ════════════════════════════════════════════════════════════════════════════
# CACHE MANAGEMENT
# ════════════════════════════════════════════════════════════════════════════

@app.get("/api/cache/list")
async def list_cache():
    entries = []
    for p in CACHE_DIR.glob("*.json"):
        try:
            data = json.loads(p.read_text())
            entries.append({
                "hash_key":  p.stem,
                "question":  data.get("question") or data.get("index_name") or "(ingestion)",
                "type":      "ingestion" if p.stem.startswith("ingest_") else "query",
                "timestamp": p.stat().st_mtime,
            })
        except Exception:
            pass
    return {"entries": sorted(entries, key=lambda x: x["timestamp"], reverse=True)}


@app.delete("/api/cache/{hash_key}")
async def delete_cache(hash_key: str):
    p = _cache_path(hash_key)
    if p.exists():
        p.unlink()
        return {"deleted": True, "hash_key": hash_key}
    raise HTTPException(404, f"No cache entry: {hash_key}")


# ════════════════════════════════════════════════════════════════════════════
# ENTRY POINT
# ════════════════════════════════════════════════════════════════════════════

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8080))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=True)
