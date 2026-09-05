# MemoryOS

## Semantic image classification

The scanner now supports these categories: Government & Identity, Education, Medical & Health,
Finance, Bills & Receipts, Work & Professional, Travel, Events & Celebrations, People & Family,
Nature & Places, Animals & Pets, Food & Drinks, Screenshots, Notes & Documents, and Others.

The backend combines Tesseract OCR with keyword scoring. Optional BLIP captioning adds visual
descriptions for photos when `MEMORYOS_ENABLE_VISION_MODEL=1`. Results are stored in MySQL.

```text
mysql < database/schema.sql
cd backend
python -m pip install -r requirements.txt
copy .env.example .env
uvicorn app:app --reload --port 8000
```

Run the frontend separately with `cd frontend && npm run dev`.

