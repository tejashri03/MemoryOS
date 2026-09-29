import io
import hashlib
import json
import os
import re
from contextlib import closing
from typing import Optional

from dotenv import load_dotenv
from fastapi import Body, FastAPI, File, Form, Query, UploadFile
from fastapi import HTTPException
from fastapi.middleware.cors import CORSMiddleware
from PIL import Image

from classifier import CATEGORIES, classify_image
from embedding_service import calculate_similarity, generate_category_scores, generate_image_embedding, generate_text_embedding

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

TEXT_WEIGHT = float(os.getenv("MEMORYOS_TEXT_WEIGHT", "0.6"))
SEMANTIC_WEIGHT = float(os.getenv("MEMORYOS_SEMANTIC_WEIGHT", "0.4"))
SEARCH_CANDIDATE_LIMIT = int(os.getenv("MEMORYOS_SEARCH_CANDIDATE_LIMIT", "100"))
OWNER_ID = os.getenv("MEMORYOS_OWNER_ID", "local-user")

app = FastAPI(title="MemoryOS semantic image classifier")
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("MEMORYOS_ALLOWED_ORIGINS", "http://localhost:5173").split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def api_root():
    return {"name": "MemoryOS API", "status": "running", "docs": "/docs", "health": "/health"}


def database_connection():
    import mysql.connector

    return mysql.connector.connect(
        host=os.getenv("MYSQL_HOST", "127.0.0.1"),
        port=int(os.getenv("MYSQL_PORT", "3306")),
        user=os.getenv("MYSQL_USER", "root"),
        password=os.getenv("MYSQL_PASSWORD", ""),
        database=os.getenv("MYSQL_DATABASE", "memoryos"),
        connection_timeout=int(os.getenv("MYSQL_CONNECT_TIMEOUT", "5")),
    )


def find_existing_image(file_hash: str, file_path: str | None = None):
    try:
        with closing(database_connection()) as connection:
            with closing(connection.cursor(dictionary=True)) as cursor:
                cursor.execute(
                    """SELECT id, filename, file_size, image_width, image_height, mime_type, category, subcategory,
                    ocr_text, ocr_confidence, ocr_status, visual_description, keywords,
                    classification_candidates, classification_evidence, classification_margin, file_path, file_modified_at,
                    confidence, created_at, processing_status FROM images
                    WHERE owner_id = %s AND file_hash = %s
                    ORDER BY ((%s IS NOT NULL AND file_path = %s) OR (%s IS NULL AND file_path IS NULL)) DESC, id DESC LIMIT 1""",
                    (OWNER_ID, file_hash, file_path, file_path, file_path),
                )
                return cursor.fetchone()
    except Exception:
        return None


def perceptual_hash(image) -> str:
    grayscale = image.convert("L").resize((8, 8))
    pixels = list(grayscale.getdata())
    average = sum(pixels) / len(pixels)
    bits = "".join("1" if pixel >= average else "0" for pixel in pixels)
    return f"{int(bits, 2):016x}"


def save_image(result, filename: str, file_size: int, mime_type: str, image_bytes: bytes, embedding, file_hash: str, image_phash: str, file_path: str | None = None, file_modified_at: str | None = None) -> Optional[int]:
    try:
        with closing(database_connection()) as connection:
            with closing(connection.cursor()) as cursor:
                cursor.execute(
                    """
                    INSERT INTO images
                              (owner_id, filename, file_path, file_size, image_width, image_height, file_hash, phash, file_modified_at, mime_type, category,
                       ocr_text, ocr_confidence, ocr_status, visual_description,
                              keywords, image_embedding, image_data, confidence, subcategory,
                              classification_candidates, classification_evidence, classification_margin, processing_status)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        OWNER_ID,
                        filename,
                        file_path,
                        file_size,
                        result.get("image_width"),
                        result.get("image_height"),
                        file_hash,
                        image_phash,
                        file_modified_at,
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
                        result.get("subcategory"),
                        json.dumps(result.get("classification_candidates", [])),
                        json.dumps(result.get("classification_evidence", {})),
                        result.get("classification_margin", 0.0),
                        result.get("processing_status", "completed"),
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


IMAGE_FIELDS = """id, filename, file_path, file_size, image_width, image_height, file_modified_at, mime_type,
    category, subcategory, location, importance, importance_score, protection_status,
    ocr_text, ocr_confidence, ocr_status, visual_description, keywords, confidence,
    classification_candidates, classification_evidence, classification_margin, file_hash, phash,
    processing_status, created_at"""


def serialise_image(item):
    if not item:
        return item
    for key in ("created_at", "file_modified_at"):
        if item.get(key):
            item[key] = item[key].isoformat()
    for field, fallback in (("classification_candidates", []), ("classification_evidence", {})):
        if isinstance(item.get(field), str):
            try:
                item[field] = json.loads(item[field])
            except json.JSONDecodeError:
                item[field] = fallback
    item["content_url"] = f"/api/images/{item['id']}/content"
    return item


@app.get("/api/images")
def list_images(
    page: int = Query(1, ge=1),
    limit: int = Query(30, ge=1, le=100),
    category: Optional[str] = Query(None, max_length=64),
    subcategory: Optional[str] = Query(None, max_length=128),
    importance: Optional[str] = Query(None, max_length=16),
    protected: Optional[bool] = Query(None),
    processing_status: Optional[str] = Query(None, alias="processingStatus"),
):
    clauses = ["owner_id = %s"]
    values = [OWNER_ID]
    for column, value in (("category", category), ("subcategory", subcategory), ("importance", importance), ("processing_status", processing_status)):
        if value:
            clauses.append(f"{column} = %s")
            values.append(value)
    if protected is not None:
        clauses.append("protection_status = %s")
        values.append("protected" if protected else "unprotected")
    where = " AND ".join(clauses)
    offset = (page - 1) * limit
    with closing(database_connection()) as connection:
        with closing(connection.cursor(dictionary=True)) as cursor:
            cursor.execute(f"SELECT COUNT(*) AS total FROM images WHERE {where}", values)
            total = cursor.fetchone()["total"]
            cursor.execute(f"SELECT {IMAGE_FIELDS} FROM images WHERE {where} ORDER BY created_at DESC LIMIT %s OFFSET %s", [*values, limit, offset])
            items = [serialise_image(item) for item in cursor.fetchall()]
    return {"items": items, "total": total, "page": page, "limit": limit}


@app.get("/api/images/stats")
def image_stats():
    with closing(database_connection()) as connection:
        with closing(connection.cursor(dictionary=True)) as cursor:
            cursor.execute("""SELECT COUNT(*) AS total,
                COALESCE(SUM(processing_status = 'completed'), 0) AS processed,
                COALESCE(SUM(processing_status = 'pending' OR processing_status = 'processing'), 0) AS pending,
                COALESCE(SUM(processing_status = 'failed'), 0) AS failed,
                COALESCE(SUM(processing_status = 'needs_review'), 0) AS needs_review,
                COALESCE(SUM(importance IN ('Critical', 'Important')), 0) AS important,
                COALESCE(SUM(protection_status = 'protected'), 0) AS protected,
                COALESCE(SUM(file_size), 0) AS storage_bytes
                FROM images WHERE owner_id = %s""", (OWNER_ID,))
            summary = cursor.fetchone()
            cursor.execute("SELECT category, COUNT(*) AS count FROM images WHERE owner_id = %s GROUP BY category ORDER BY count DESC", (OWNER_ID,))
            summary["categories"] = cursor.fetchall()
            cursor.execute("SELECT COUNT(*) AS count FROM images WHERE owner_id = %s AND phash IS NOT NULL GROUP BY phash HAVING COUNT(*) > 1", (OWNER_ID,))
            summary["duplicate_groups"] = cursor.fetchall()
    return summary


@app.get("/api/review")
def review_images(page: int = Query(1, ge=1), limit: int = Query(30, ge=1, le=100)):
    result = list_images(page=page, limit=limit, processing_status="needs_review")
    return result


@app.patch("/api/images/{image_id}/review")
def resolve_review(image_id: int, decision: dict = Body(...)):
    category = decision.get("category")
    subcategory = decision.get("subcategory")
    if category not in CATEGORIES:
        raise HTTPException(status_code=400, detail="A valid category is required")
    with closing(database_connection()) as connection:
        with closing(connection.cursor()) as cursor:
            cursor.execute("""UPDATE images SET category = %s, subcategory = %s,
                processing_status = 'completed', confidence = GREATEST(confidence, 0.75)
                WHERE id = %s AND owner_id = %s""", (category, subcategory, image_id, OWNER_ID))
            connection.commit()
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Image not found")
    return {"id": image_id, "category": category, "subcategory": subcategory, "processing_status": "completed"}


@app.get("/api/duplicates")
def duplicate_images():
    with closing(database_connection()) as connection:
        with closing(connection.cursor(dictionary=True)) as cursor:
            cursor.execute(f"""SELECT {IMAGE_FIELDS} FROM images
                WHERE owner_id = %s AND phash IS NOT NULL ORDER BY created_at DESC""", (OWNER_ID,))
            images = [serialise_image(item) for item in cursor.fetchall()]
    groups = []
    children = {}
    root = None
    for image in images:
        fingerprint = image["phash"]
        value = int(fingerprint, 16)
        best_index = None
        best_distance = 65
        if root is not None:
            pending = [root]
            while pending:
                candidate_index = pending.pop()
                candidate_value = int(groups[candidate_index]["fingerprint"], 16)
                distance = (value ^ candidate_value).bit_count()
                if distance <= 6 and distance < best_distance:
                    best_index, best_distance = candidate_index, distance
                pending.extend(child for edge, child in children[candidate_index].items() if distance - 6 <= edge <= distance + 6)
        best = groups[best_index] if best_index is not None else None
        if best is None:
            groups.append({"fingerprint": fingerprint, "type": "exact_duplicate", "similarity": 100, "items": [image]})
            new_index = len(groups) - 1
            children[new_index] = {}
            if root is None:
                root = new_index
            else:
                node = root
                while True:
                    edge = (value ^ int(groups[node]["fingerprint"], 16)).bit_count()
                    if edge in children[node]:
                        node = children[node][edge]
                    else:
                        children[node][edge] = new_index
                        break
        else:
            similarity = round((64 - best_distance) / 64 * 100)
            best["type"] = "exact_duplicate" if best_distance == 0 else "near_duplicate"
            best["similarity"] = min(best["similarity"], similarity)
            best["items"].append(image)
    for group in groups:
        hashes = {item.get("file_hash") for item in group["items"]}
        group["type"] = "exact_duplicate" if len(hashes) == 1 and None not in hashes else "near_duplicate"
    return {"groups": [group for group in groups if len(group["items"]) > 1]}


@app.get("/api/search")
def search_images(
    q: str = Query(..., min_length=1, max_length=200),
    category: Optional[str] = Query(None, max_length=64),
    importance: Optional[str] = Query(None, max_length=16),
    date_from: Optional[str] = Query(None, alias="dateFrom"),
    date_to: Optional[str] = Query(None, alias="dateTo"),
    location: Optional[str] = Query(None, max_length=512),
    subcategory: Optional[str] = Query(None, max_length=128),
    protected: Optional[bool] = Query(None),
    mime_type: Optional[str] = Query(None, alias="fileType", max_length=128),
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
    if subcategory:
        clauses.append("subcategory = %s")
        values.append(subcategory)
    if protected is not None:
        clauses.append("protection_status = %s")
        values.append("protected" if protected else "unprotected")
    if mime_type:
        clauses.append("mime_type = %s")
        values.append(mime_type)
    where = " AND ".join(clauses)
    semantic_query = generate_text_embedding(query)
    offset = (page - 1) * limit
    with closing(database_connection()) as connection:
        with closing(connection.cursor(dictionary=True)) as cursor:
            cursor.execute(
                f"""SELECT COUNT(*) AS total FROM images WHERE {where}
                AND MATCH(filename, ocr_text, visual_description, keywords, category, subcategory, location)
                AGAINST (%s IN BOOLEAN MODE)""",
                [*values, text_query],
            )
            total_matches = cursor.fetchone()["total"]
            cursor.execute(
                f"""SELECT id, filename, file_size, image_width, image_height, mime_type, category, subcategory,
                    file_path, file_modified_at, file_hash, phash, location, importance, importance_score, protection_status,
                    ocr_text, ocr_confidence, ocr_status, visual_description, keywords, confidence,
                    classification_candidates, classification_evidence, classification_margin, processing_status, created_at, image_embedding,
                    (MATCH(filename, ocr_text, visual_description, keywords, category, subcategory, location)
                      AGAINST (%s IN BOOLEAN MODE)) AS text_score
                    FROM images WHERE {where}
                    ORDER BY text_score DESC, id DESC LIMIT %s""",
                [text_query, *values, SEARCH_CANDIDATE_LIMIT],
            )
            candidates = cursor.fetchall()
    for item in candidates:
        embedding = np_from_bytes(item.pop("image_embedding", None))
        item["semantic_score"] = round((max(-1.0, calculate_similarity(embedding, semantic_query)) + 1.0) / 2.0, 6)
        item["text_score"] = float(item.get("text_score") or 0)
        item["final_score"] = round(TEXT_WEIGHT * normalize_text_score(item["text_score"]) + SEMANTIC_WEIGHT * item["semantic_score"], 6)
        item["created_at"] = item["created_at"].isoformat() if item.get("created_at") else None
        item.pop("text_score", None)
    candidates.sort(key=lambda item: item["final_score"], reverse=True if sort == "relevance" else False)
    if sort in ("newest", "oldest", "name"):
        key = "created_at" if sort != "name" else "filename"
        candidates.sort(key=lambda item: item.get(key) or "", reverse=sort == "newest")
    for item in candidates:
        serialise_image(item)
        item["match_reason"] = build_match_reason(query, item)
    return {"items": candidates[offset:offset + limit], "total": total_matches, "page": page, "limit": limit, "candidate_limit": SEARCH_CANDIDATE_LIMIT}


def build_match_reason(query: str, item: dict) -> dict:
    terms = set(re.findall(r"[a-z0-9]+", query.lower()))
    ocr = set(re.findall(r"[a-z0-9]+", (item.get("ocr_text") or "").lower()))
    filename = set(re.findall(r"[a-z0-9]+", (item.get("filename") or "").lower()))
    category = set(re.findall(r"[a-z0-9]+", f"{item.get('category') or ''} {item.get('subcategory') or ''}".lower()))
    keywords = set(re.findall(r"[a-z0-9]+", (item.get("keywords") or "").lower()))
    return {
        "ocr": sorted(terms.intersection(ocr)),
        "filename": sorted(terms.intersection(filename)),
        "category": sorted(terms.intersection(category)),
        "keywords": sorted(terms.intersection(keywords)),
        "semantic": item.get("semantic_score", 0) >= 0.65,
    }


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


@app.patch("/api/images/{image_id}")
def update_image(image_id: int, changes: dict = Body(...)):
    allowed = {"category", "subcategory", "location", "importance", "importance_score", "protection_status"}
    updates = {key: value for key, value in changes.items() if key in allowed}
    if not updates:
        raise HTTPException(status_code=400, detail="No editable fields supplied")
    assignments = ", ".join(f"{key} = %s" for key in updates)
    values = list(updates.values()) + [image_id, OWNER_ID]
    with closing(database_connection()) as connection:
        with closing(connection.cursor()) as cursor:
            cursor.execute(f"UPDATE images SET {assignments} WHERE id = %s AND owner_id = %s", values)
            connection.commit()
            if cursor.rowcount == 0:
                raise HTTPException(status_code=404, detail="Image not found")
    return {"id": image_id, **updates}


@app.delete("/api/images/{image_id}")
def delete_image(image_id: int, confirm: bool = Query(False)):
    with closing(database_connection()) as connection:
        with closing(connection.cursor(dictionary=True)) as cursor:
            cursor.execute("SELECT protection_status, importance_score FROM images WHERE id = %s AND owner_id = %s", (image_id, OWNER_ID))
            image = cursor.fetchone()
        if not image:
            raise HTTPException(status_code=404, detail="Image not found")
        if (image["protection_status"] == "protected" or image["importance_score"] >= 60) and not confirm:
            raise HTTPException(status_code=409, detail="Explicit confirmation required for this protected or important image")
        with closing(connection.cursor()) as cursor:
            cursor.execute("DELETE FROM images WHERE id = %s AND owner_id = %s", (image_id, OWNER_ID))
            connection.commit()
    return {"deleted": image_id}


@app.post("/api/images/classify")
async def classify_upload(
    file: UploadFile = File(...),
    persist: bool = Form(True),
    file_path: Optional[str] = Form(None),
    file_modified_at: Optional[str] = Form(None),
):
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")
    file_hash = hashlib.sha256(contents).hexdigest()
    image_phash = perceptual_hash(image)
    existing = find_existing_image(file_hash, file_path) if persist else None
    same_path = existing and existing.get("file_path") == file_path and existing.get("file_size") == len(contents)
    duplicate_of = existing.get("id") if existing and not same_path else None
    if same_path:
        stored_modified = existing.get("file_modified_at")
        stored_modified = stored_modified.strftime("%Y-%m-%d %H:%M:%S") if stored_modified else None
        incoming_modified = file_modified_at.replace("T", " ")[:19] if file_modified_at else None
        if incoming_modified and incoming_modified != stored_modified:
            with closing(database_connection()) as connection:
                with closing(connection.cursor()) as cursor:
                    cursor.execute("UPDATE images SET file_modified_at = %s WHERE id = %s AND owner_id = %s", (incoming_modified, existing["id"], OWNER_ID))
                    connection.commit()
            existing["file_modified_at"] = incoming_modified
        if existing.get("created_at"):
            existing["created_at"] = existing["created_at"].isoformat()
        if existing.get("file_modified_at"):
            existing["file_modified_at"] = existing["file_modified_at"].isoformat() if hasattr(existing["file_modified_at"], "isoformat") else existing["file_modified_at"]
        existing["embedding_status"] = "reused"
        return existing
    embedding = generate_image_embedding(image)
    result = classify_image(
        image,
        file.filename or "image",
        file.content_type or "image/*",
        image_embedding=embedding,
        semantic_scores=generate_category_scores(embedding),
    )
    result["image_width"], result["image_height"] = image.size
    result["id"] = save_image(result, file.filename or "image", len(contents), file.content_type or "image/*", contents, embedding, file_hash, image_phash, file_path, file_modified_at) if persist else None
    result["duplicate_of"] = duplicate_of
    result["embedding_status"] = "complete" if embedding is not None else "disabled"
    return result
