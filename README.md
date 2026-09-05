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

The pure `classify_text` function is covered by backend regression tests and can be run without
Tesseract installed:

```text
cd backend
python -m unittest discover -v
```

```text
mysql < database/schema.sql
cd backend
python -m pip install -r requirements.txt
copy .env.example .env
uvicorn app:app --reload --port 8000
```

Run the frontend separately with `cd frontend && npm run dev`.

