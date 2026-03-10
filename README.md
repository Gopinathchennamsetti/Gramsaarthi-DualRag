# DualRAG — Full-Stack App

Frontend (React + Vite) + Backend (FastAPI) wired directly into your
`execution.py` and `ingestion.py` core logic.

```
backend/
├── main.py              ← FastAPI server  (THIS IS THE ONLY NEW FILE)
├── execution.py         ← YOUR core retrieval + LLM logic
├── ingestion.py         ← YOUR core PDF ingestion pipeline
├── config.json          ← YOUR LLM / vector store config
├── .env                 ← YOUR API keys
├── input_schemes.json
├── input_faqs.json
├── requirements.txt     ← FastAPI deps (add to your existing reqs)
├── requirements_pipeline.txt  ← copy of your original requirements.txt
├── data/
│   ├── schemes/         ← drop official scheme PDFs here
│   └── faqs/            ← drop citizen FAQ PDFs here
├── chroma_db/           ← auto-created by chromadb
├── uploads/             ← auto-created, stores ingested PDFs
└── report_cache/        ← auto-created, stores cached reports as JSON

frontend/
├── index.html
├── package.json
├── vite.config.js
└── src/
    ├── main.jsx
    └── App.jsx          ← Single-file React app
```

---

## How main.py connects to your code

```python
# main.py does exactly this — no magic, no dynamic discovery:
from execution import DualRAGProcessor, config, _chroma_count, _opensearch_count
from ingestion  import IngestionPipeline

# Query route calls:
result = await DualRAGProcessor().query({"question": ..., "filters": ..., "options": ...})

# Ingest route calls:
result = await IngestionPipeline().ingest({
    "index_name": "schemes_index",
    "documents": [{"document_id": ..., "document_name": ..., "local_path": ..., "metadata": {...}}],
    "options": {"delete_existing": True, "validate_after_insert": True}
})
```

---

## Quick Start

### 1. Backend

```bash
cd backend

# Install FastAPI on top of your existing deps
pip install fastapi uvicorn[standard] python-multipart

# Your pipeline deps (if not already installed)
pip install -r requirements_pipeline.txt

# Make sure your .env has the API key for whichever provider is in config.json
# e.g. GEMINI_API_KEY=...

uvicorn main:app --host 0.0.0.0 --port 8080 --reload
# → API at http://localhost:8080
# → Docs at http://localhost:8080/docs
```

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
# → http://localhost:5173
```

Notes:
- In `npm run dev`, the frontend calls `/api/...` and Vite proxies to `http://localhost:8080` (see `frontend/vite.config.js`).
- To override the backend base URL, run with `VITE_API_BASE_URL=http://localhost:8080 npm run dev` (or set it in a Vite `.env` file).

---

## Hash-based Caching

Every query and ingestion is hashed:

```
query_hash    = SHA256(question + filters + options)[:16]
ingestion_hash = SHA256(filename + index_name + doc_type + metadata)[:16]
```

Cached results are stored in `backend/report_cache/`.

- **Query flow**: hash checked → if exists, report shown immediately + popup asks "Regenerate?"
- **Ingest flow**: hash checked → if exists, result shown + popup asks "Re-ingest?"

Pass `force: true` (query) or `force: "true"` (ingest form) to bypass cache.

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/health` | Pipeline import status + config |
| GET | `/api/indexes/stats` | Doc counts in both ChromaDB/OpenSearch indexes |
| POST | `/api/report/check` | Check cache by hash (no LLM call) |
| POST | `/api/report/execute` | Run DualRAGProcessor.query() |
| POST | `/api/ingest/check` | Check if already ingested |
| POST | `/api/ingest` | Run IngestionPipeline.ingest() |
| GET | `/api/cache/list` | List all cached entries |
| DELETE | `/api/cache/{key}` | Delete a cache entry |
