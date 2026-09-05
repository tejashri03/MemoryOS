import io
import os
import re
from contextlib import closing
from typing import Optional

from fastapi import FastAPI, File, Form, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from classifier import CATEGORIES, classify_image

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


def save_image(result, filename: str, file_size: int, mime_type: str) -> Optional[int]:
    try:
        with closing(database_connection()) as connection:
            with closing(connection.cursor()) as cursor:
                cursor.execute(
                    """
                    INSERT INTO images
                      (filename, file_size, mime_type, category, ocr_text,
                       visual_description, confidence)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        filename,
                        file_size,
                        mime_type,
                        result["category"],
                        result["ocr_text"],
                        result["visual_description"],
                        result["confidence"],
                    ),
                )
                connection.commit()
                return cursor.lastrowid
    except Exception:
        return None


@app.get("/health")
def health():
    return {"status": "ok", "categories": CATEGORIES}


@app.post("/api/images/classify")
async def classify_upload(
    file: UploadFile = File(...),
    persist: bool = Form(True),
):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    result = classify_image(image, file.filename or "image", file.content_type or "image/*")
    result["id"] = save_image(result, file.filename or "image", len(contents), file.content_type or "image/*") if persist else None
    return result
