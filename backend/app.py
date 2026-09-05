import io
import os
import re
from contextlib import closing
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Query, UploadFile
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from classifier import CATEGORIES, classify_image
from embedding_service import calculate_similarity, generate_image_embedding, generate_text_embedding

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

TEXT_WEIGHT = float(os.getenv("MEMORYOS_TEXT_WEIGHT", "0.6"))
SEMANTIC_WEIGHT = float(os.getenv("MEMORYOS_SEMANTIC_WEIGHT", "0.4"))
OWNER_ID = os.getenv("MEMORYOS_OWNER_ID", "local-user")

app = FastAPI(title="MemoryOS semantic image classifier")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("MEMORYOS_ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def database_connection():
    import mysql.connector

    return mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        database=os.getenv("MYSQL_DATABASE", "memoryos"),
    )


def save_image(result, filename: str, file_size: int, mime_type: str, image_bytes: bytes, embedding) -> Optional[int]:
    try:
        with closing(database_connection()) as connection:
            with closing(connection.cursor()) as cursor:
                cursor.execute(
                    """
                    INSERT INTO images
                      (owner_id, filename, file_size, mime_type, category,
                       ocr_text, ocr_confidence, ocr_status, visual_description,
                       keywords, image_embedding, image_data, confidence)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        OWNER_ID,
                        filename,
                        file_size,
                        mime_type,
                        result["category"],
                        result["ocr_text"],
                        result["ocr_confidence"],
                        result["ocr_status"],
                        result["visual_description"],
                        result["keywords"],
                        embedding.tobytes() if embedding is not None else None,
                        image_bytes,
                        result["confidence"],
                    ),
                )
                connection.commit()
                return cursor.lastrowid
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"Database save failed: {error}") from error


@app.get("/health")
def health():
    try:
        with closing(database_connection()) as connection:
            with closing(connection.cursor()) as cursor:
                cursor.execute("SELECT COUNT(*) FROM images WHERE owner_id = %s", (OWNER_ID,))
                image_count = cursor.fetchone()[0]
        return {"status": "ok", "database": "connected", "image_count": image_count, "categories": CATEGORIES}
    except Exception as error:
        return {"status": "degraded", "database": "unavailable", "detail": str(error), "categories": CATEGORIES}


@app.get("/api/search")
def search_images(
    q: str = Query(..., min_length=1, max_length=200),
    category: Optional[str] = Query(None, max_length=64),
    importance: Optional[str] = Query(None, max_length=16),
    date_from: Optional[str] = Query(None, alias="dateFrom"),
    date_to: Optional[str] = Query(None, alias="dateTo"),
    location: Optional[str] = Query(None, max_length=512),
    page: int = Query(1, ge=1, le=10000),
    limit: int = Query(30, ge=1, le=100),
    sort: str = Query("relevance"),
):
    query = q.strip()
    text_query = " ".join(re.findall(r"[a-zA-Z0-9_]+", query))
    if not text_query:
        return {"items": [], "total": 0, "page": page, "limit": limit}
    clauses = ["owner_id = %s"]
    values = [OWNER_ID]
    if category:
        clauses.append("category = %s")
        values.append(category)
    if importance:
        clauses.append("importance = %s")
        values.append(importance)
    if date_from:
        clauses.append("created_at >= %s")
        values.append(date_from)
    if date_to:
        clauses.append("created_at < DATE_ADD(%s, INTERVAL 1 DAY)")
        values.append(date_to)
    if location:
        clauses.append("location LIKE %s")
        values.append(f"%{location}%")
    where = " AND ".join(clauses)
    semantic_query = generate_text_embedding(query)
    offset = (page - 1) * limit
    with closing(database_connection()) as connection:
        with closing(connection.cursor(dictionary=True)) as cursor:
            cursor.execute(
                f"""SELECT id, filename, file_size, mime_type, category, subcategory,
                    location, importance, ocr_text, ocr_confidence, ocr_status,
                    visual_description, keywords, created_at, image_embedding,
                    (MATCH(filename, ocr_text, visual_description, keywords, category, subcategory, location)
                      AGAINST (%s IN BOOLEAN MODE)) AS text_score
                    FROM images WHERE {where}""",
                [text_query, *values],
            )
            candidates = cursor.fetchall()
    for item in candidates:
        embedding = np_from_bytes(item.pop("image_embedding", None))
        item["semantic_score"] = round(max(0.0, calculate_similarity(embedding, semantic_query)), 6)
        item["text_score"] = float(item.get("text_score") or 0)
        item["final_score"] = round(TEXT_WEIGHT * normalize_text_score(item["text_score"]) + SEMANTIC_WEIGHT * item["semantic_score"], 6)
        item["created_at"] = item["created_at"].isoformat() if item.get("created_at") else None
        item.pop("text_score", None)
    candidates.sort(key=lambda item: item["final_score"], reverse=True if sort == "relevance" else False)
    if sort in ("newest", "oldest", "name"):
        key = "created_at" if sort != "name" else "filename"
        candidates.sort(key=lambda item: item.get(key) or "", reverse=sort == "newest")
    return {"items": candidates[offset:offset + limit], "total": len(candidates), "page": page, "limit": limit}


@app.get("/api/images/{image_id}/content")
def image_content(image_id: int):
    from fastapi import HTTPException
    from fastapi.responses import Response

    with closing(database_connection()) as connection:
        with closing(connection.cursor(dictionary=True)) as cursor:
            cursor.execute(
                "SELECT image_data, mime_type FROM images WHERE id = %s AND owner_id = %s",
                (image_id, OWNER_ID),
            )
            item = cursor.fetchone()
    if not item or not item["image_data"]:
        raise HTTPException(status_code=404, detail="Image content not found")
    return Response(content=item["image_data"], media_type=item["mime_type"])


def np_from_bytes(value):
    if not value:
        return None
    import numpy as np
    return np.frombuffer(value, dtype=np.float32)


def normalize_text_score(value):
    return value / (value + 1.0) if value > 0 else 0.0


@app.post("/api/images/classify")
async def classify_upload(
    file: UploadFile = File(...),
    persist: bool = Form(True),
):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    result = classify_image(image, file.filename or "image", file.content_type or "image/*")
    embedding = generate_image_embedding(image)
    result["id"] = save_image(result, file.filename or "image", len(contents), file.content_type or "image/*", contents, embedding) if persist else None
    result["embedding_status"] = "complete" if embedding is not None else "disabled"
    return result
