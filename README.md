# MemoryOS

## Local semantic image search

The scanner now supports these categories: Government & Identity, Education, Medical & Health,
Finance, Bills & Receipts, Work & Professional, Travel, Events & Celebrations, People & Family,
Nature & Places, Animals & Pets, Food & Drinks, Screenshots, Notes & Documents, and Others.

The backend combines Tesseract OCR with keyword scoring. Optional BLIP captioning adds visual
descriptions for photos when `MEMORYOS_ENABLE_VISION_MODEL=1`. Results are stored in MySQL.

```text
mysql < database/schema.sql
cd backend
uv venv --python 3.12 .venv
uv pip install --python .venv\Scripts\python.exe -r requirements.txt
copy .env.example .env
.venv\Scripts\python.exe -m uvicorn app:app --reload --port 8000
```

Run the frontend separately with `cd frontend && npm run dev`.

Search is available at `GET /api/search?q=certificate&page=1&limit=30`. Supported filters are
`category`, `importance`, `dateFrom`, `dateTo`, `location`, and `sort` (`relevance`, `newest`,
`oldest`, or `name`). Models are loaded lazily and image embeddings are generated once during
 classification. Existing databases should be recreated from `database/schema.sql`, or updated by running
`database/001_search_pipeline.sql`, before indexing. The current app has a local-user auth
boundary (`MEMORYOS_OWNER_ID`); connect it to the project's JWT gateway by setting that value
per authenticated service instance before exposing the API beyond localhost.
with equivalent `ALTER TABLE` statements) before indexing.

