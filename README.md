# MemoryOS

## Local semantic image search

MemoryOS indexes local image libraries into these categories: Government & Identity, Education,
Medical & Health, Finance, Bills & Receipts, Work & Professional, Travel, Events & Celebrations,
People & Family, Nature & Places, Animals & Pets, Food & Drinks, Screenshots, Notes & Documents,
and Others. The backend uses PaddleOCR, rule-based evidence, optional BLIP descriptions, and cached
OpenCLIP image/category embeddings. It stores OCR, descriptions, keywords, embeddings, category
candidates, and explainable classification evidence in MySQL.

## First-time setup

Run these commands from the project root in PowerShell:

```powershell
Get-Content -Raw database/schema.sql | mysql
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
Copy-Item .env.example .env
.\.venv\Scripts\python.exe -m uvicorn app:app --reload --port 8000
```

In a second PowerShell window, from the project root:

```powershell
cd frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`). Set MySQL credentials
and model options in `backend/.env`. Models are loaded once per backend process and reused. The
first model use may download model files; later runs use the local cache.

## Updating an existing database

For a database created before the search pipeline, apply the migrations in order:

```powershell
Get-Content -Raw database/001_search_pipeline.sql | mysql memoryos
Get-Content -Raw database/002_processing_and_review.sql | mysql memoryos
Get-Content -Raw database/003_duplicate_and_processing_indexes.sql | mysql memoryos
Get-Content -Raw database/004_classification_evidence.sql | mysql memoryos
Get-Content -Raw database/005_image_dimensions.sql | mysql memoryos
```

The processing/review migration adds file fingerprints and metadata, duplicate detection, review
status, and protection fields. The duplicate migration allows identical files at different paths to
be represented separately. Classification evidence, score margin, and image dimensions are stored
for details-panel inspection.
For a new database, `database/schema.sql` already includes the current structure; do not run the
migrations again after creating it from that schema.

## Search and API

Search is available at `GET /api/search?q=certificate&page=1&limit=30`. Supported filters include
`category`, `importance`, `dateFrom`, `dateTo`, `location`, and `sort` (`relevance`, `newest`,
`oldest`, or `name`). Folder indexing reuses results for an unchanged file at the same path and
reports skipped files in the Processing view. Exact duplicates at different paths remain distinct
library entries. No image is deleted automatically.

The API uses a local-user boundary (`MEMORYOS_OWNER_ID`). Connect it to the project's JWT gateway
by setting that value per authenticated service instance before exposing the API beyond localhost.

## Evaluation and tests

Run the classifier tests and the labeled-record evaluation from `backend`:

```powershell
.\.venv\Scripts\python.exe -m unittest -v test_classifier
.\.venv\Scripts\python.exe evaluate.py evaluation/dataset.jsonl
```

Add labeled JSONL records under `backend/evaluation/dataset.jsonl`. The evaluation reports measured
results only for the supplied records; it does not estimate accuracy. Build the frontend with:

```powershell
cd frontend
npm run build
```
