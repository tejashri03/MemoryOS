# MemoryOS

## Semantic image classification

The scanner now supports these categories: Government & Identity, Education, Medical & Health,
Finance, Bills & Receipts, Work & Professional, Travel, Events & Celebrations, People & Family,
Nature & Places, Animals & Pets, Food & Drinks, Screenshots, Notes & Documents, and Others.

The backend combines Tesseract OCR with weighted phrase and keyword scoring. OCR evidence is
weighted above filenames, category contradictions are penalized, and ambiguous evidence falls
back to `Others` with zero confidence instead of forcing a guess. Optional BLIP captioning adds
visual descriptions for photos when `MEMORYOS_ENABLE_VISION_MODEL=1`; those captions are scored
as visual evidence. Results are stored in MySQL.

## Importance and deletion protection

Each classified image receives a server-calculated score from 0 to 100, an importance level,
and a protection status. Sensitive/official documents, important categories, class-specific
keywords, OCR text, recency, and the user's manual importance flag contribute explainable points. Protected
images cannot be deleted through the API. Images in the 60-79 score range require an explicit
delete confirmation.

The pure `classify_text` function is covered by backend regression tests and can be run without
Tesseract installed:

```text
cd backend
python -m unittest discover -v
```

Duplicate detection is conservative: exact file content uses SHA-256, while re-encoded copies
must also match visual edge structure, color distribution, and aspect ratio. File size, format,
or shared layout alone is never treated as proof of duplication.

```text
mysql < database/schema.sql
mysql memoryos < database/migrations/001_importance_protection.sql
cd backend
python -m pip install -r requirements.txt
copy .env.example .env
uvicorn app:app --reload --port 8000
```

Run the one-time backfill after applying the migration to calculate values for existing rows:

```text
cd backend
python recalculate_importance.py
```

The API also supports `PATCH /api/images/{id}/importance` and
`DELETE /api/images/{id}?confirmed=true`. The server recalculates protection and never trusts a
client-provided score or protection flag. Set `MEMORYOS_MAX_UPLOAD_BYTES` to override the default
25 MB upload limit.

Run the frontend separately with `cd frontend && npm run dev`.

