import os
import re
from functools import lru_cache

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter, ImageOps

CATEGORIES = [
    "Government & Identity",
    "Education",
    "Medical & Health",
    "Finance",
    "Bills & Receipts",
    "Work & Professional",
    "Travel",
    "Events & Celebrations",
    "People & Family",
    "Nature & Places",
    "Animals & Pets",
    "Food & Drinks",
    "Screenshots",
    "Notes & Documents",
    "Others",
]

PROFILES = {
    "Government & Identity": {
        "phrases": {"aadhaar card": 10, "pan card": 10, "driving licence": 10, "driver license": 10, "voter id": 10, "id card": 12, "identity card": 12, "id proof": 12, "identity proof": 12, "government id": 12, "national id": 11, "birth certificate": 9, "passport number": 8},
        "keywords": {"aadhaar": 7, "passport": 5, "identity": 5, "voter": 5, "election": 4, "licence": 5, "license": 5, "nationality": 4, "dob": 4, "address": 3},
        "avoid": {"boarding pass": 7, "flight": 4, "airport": 4, "hotel": 4, "itinerary": 5},
    },
    "Education": {
        "phrases": {"mark sheet": 10, "marksheet": 10, "transcript": 9, "report card": 9, "school certificate": 9, "degree certificate": 10, "admit card": 8},
        "keywords": {"certificate": 4, "degree": 6, "diploma": 7, "university": 5, "college": 5, "school": 5, "student": 4, "exam": 5, "assignment": 4, "thesis": 5, "semester": 5, "grade": 4},
        "avoid": {"birth certificate": 8, "medical certificate": 6, "certificate of insurance": 5},
    },
    "Medical & Health": {
        "phrases": {"medical report": 10, "blood test": 10, "blood pressure": 9, "doctor note": 9, "prescription": 10, "discharge summary": 10, "lab report": 9},
        "keywords": {"hospital": 7, "doctor": 7, "patient": 7, "diagnosis": 8, "medicine": 6, "pharmacy": 6, "symptom": 6, "laboratory": 6, "health": 4, "dosage": 7},
        "avoid": {"health insurance": 3, "restaurant": 4},
    },
    "Finance": {
        "phrases": {"bank statement": 10, "account statement": 10, "income certificate": 12, "income cert": 12, "income tax": 10, "tax return": 10, "credit card": 9, "account number": 7, "mutual fund": 8},
        "keywords": {"bank": 6, "tax": 7, "salary": 6, "income": 6, "transaction": 6, "payment": 4, "cheque": 7, "loan": 6, "investment": 6, "ifsc": 8, "balance": 4},
        "avoid": {"receipt": 4, "invoice": 4, "utility bill": 5},
    },
    "Bills & Receipts": {
        "phrases": {"tax invoice": 10, "purchase receipt": 10, "order total": 8, "amount due": 9, "invoice number": 10, "utility bill": 10, "payment receipt": 9},
        "keywords": {"receipt": 8, "invoice": 8, "bill": 7, "subtotal": 7, "total": 4, "gst": 7, "barcode": 5, "quantity": 4, "discount": 5, "due": 4},
        "avoid": {"bank statement": 5, "medical bill": 3},
    },
    "Work & Professional": {
        "phrases": {"offer letter": 10, "cover letter": 9, "job application": 9, "business card": 9, "meeting notes": 8, " LinkedIn ": 8},
        "keywords": {"resume": 8, "curriculum": 6, "employment": 7, "company": 5, "employee": 6, "office": 5, "professional": 5, "linkedin": 7, "client": 5, "project": 4, "agenda": 5},
        "avoid": {"school project": 5},
    },
    "Travel": {
        "phrases": {"boarding pass": 12, "flight ticket": 11, "train ticket": 11, "hotel booking": 11, "travel itinerary": 11, "booking confirmation": 9, "car rental": 9},
        "keywords": {"flight": 8, "airport": 8, "airline": 8, "boarding": 7, "train": 7, "hotel": 7, "itinerary": 8, "vacation": 5, "trip": 4, "tourist": 5, "departure": 6, "arrival": 6},
        "avoid": {"passport number": 5, "passport photo": 7},
    },
    "Events & Celebrations": {
        "phrases": {"birthday party": 11, "wedding invitation": 12, "save the date": 11, "baby shower": 11, "wedding ceremony": 10, "event invitation": 10},
        "keywords": {"birthday": 8, "wedding": 8, "party": 7, "festival": 6, "celebration": 7, "christmas": 6, "diwali": 6, "ceremony": 6, "invitation": 7, "cake": 5},
        "avoid": {"party receipt": 4},
    },
    "People & Family": {
        "phrases": {"family photo": 11, "family portrait": 11, "group photo": 10, "wedding photo": 8, "self portrait": 9},
        "keywords": {"family": 8, "person": 5, "people": 5, "portrait": 8, "friend": 6, "selfie": 8, "face": 5, "child": 6, "baby": 5, "group": 4},
        "avoid": {"profile screenshot": 6},
    },
    "Nature & Places": {
        "phrases": {"city skyline": 10, "national park": 10, "tourist attraction": 9, "street view": 9, "landscape photo": 9},
        "keywords": {"mountain": 7, "beach": 6, "landscape": 8, "sunset": 7, "lake": 7, "river": 6, "building": 5, "city": 5, "monument": 8, "forest": 7, "nature": 7, "skyline": 7},
        "avoid": {"beach vacation": 3, "hotel": 3},
    },
    "Animals & Pets": {
        "phrases": {"pet dog": 11, "pet cat": 11, "animal shelter": 10, "wildlife photo": 10},
        "keywords": {"dog": 9, "cat": 9, "bird": 8, "pet": 8, "horse": 8, "wildlife": 9, "animal": 8, "puppy": 9, "kitten": 9},
        "avoid": {"hot dog": 8},
    },
    "Food & Drinks": {
        "phrases": {"food menu": 10, "restaurant receipt": 10, "meal photo": 10, "coffee cup": 9},
        "keywords": {"food": 8, "restaurant": 8, "dish": 7, "meal": 7, "lunch": 7, "dinner": 7, "breakfast": 7, "coffee": 8, "tea": 7, "drink": 7, "pizza": 8, "menu": 7},
        "avoid": {"receipt": 2},
    },
    "Screenshots": {
        "phrases": {"screen capture": 12, "mobile screenshot": 12, "chat screenshot": 12, "error message": 9, "browser window": 9},
        "keywords": {"screenshot": 12, "screen": 6, "capture": 6, "mobile": 6, "application": 5, "app": 5, "website": 6, "chat": 7, "whatsapp": 10, "browser": 8, "notification": 6, "url": 5},
        "avoid": {},
    },
    "Notes & Documents": {
        "phrases": {"handwritten note": 11, "meeting notes": 8, "scanned document": 11, "white board": 10, "legal document": 9},
        "keywords": {"note": 7, "handwritten": 10, "handwriting": 10, "whiteboard": 9, "document": 6, "scanned": 7, "paper": 5, "memo": 7, "text": 3, "signature": 6},
        "avoid": {"identity document": 6, "travel document": 5, "medical report": 6},
    },
}


def _tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", value.lower()))


def _normalise(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def _phrase_present(text: str, phrase: str) -> bool:
    return re.search(rf"\b{re.escape(_normalise(phrase))}\b", text) is not None


def _score_profile(profile: dict, filename: str, ocr_text: str, visual_description: str) -> float:
    score = 0.0
    sources = ((filename, 2.0), (ocr_text, 4.0), (visual_description, 3.0))
    for value, source_weight in sources:
        text = _normalise(value)
        if not text:
            continue
        for phrase, weight in profile["phrases"].items():
            if _phrase_present(text, phrase):
                score += weight * source_weight
        token_values = _tokens(text)
        for keyword, weight in profile["keywords"].items():
            if _normalise(keyword) in token_values:
                score += weight * source_weight
        for phrase, penalty in profile["avoid"].items():
            if _phrase_present(text, phrase):
                score -= penalty * source_weight
    return max(score, 0.0)


def classify_text(filename: str, ocr_text: str = "", visual_description: str = "") -> tuple[str, float, dict[str, float]]:
    """Classify extracted evidence without requiring an OCR or image runtime."""
    scores = {
        category: round(_score_profile(profile, filename, ocr_text, visual_description), 2)
        for category, profile in PROFILES.items()
    }
    combined_text = _normalise(f"{filename} {ocr_text} {visual_description}")
    filename_text = _normalise(filename)
    receipt_markers = (
        "receipt", "invoice", "subtotal", "amount due", "order total", "payment receipt",
        "gst", "barcode", "quantity", "discount", "cashier",
    )
    finance_markers = (
        "bank statement", "account statement", "income certificate", "income cert", "income tax", "tax return", "credit card",
        "ifsc", "account number", "transaction id",
    )
    identity_markers = (
        "id card", "identity card", "id proof", "identity proof", "government id", "national id",
        "aadhaar card", "pan card", "voter id", "driving licence", "driver license",
    )
    if any(_phrase_present(combined_text, marker) for marker in receipt_markers):
        scores["Bills & Receipts"] += 45
    if any(_phrase_present(combined_text, marker) for marker in finance_markers):
        scores["Finance"] += 45
    if any(_phrase_present(combined_text, marker) for marker in identity_markers):
        scores["Government & Identity"] += 45
    if re.search(r"(^| )id( |$)", filename_text):
        scores["Government & Identity"] += 45

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best_category, best_score = ranked[0]
    second_score = ranked[1][1]
    total = sum(scores.values())
    margin = best_score - second_score
    if best_score < 8 or (best_score < 18 and margin < 5):
        return "Others", 0.0, scores
    confidence = min(0.99, max(0.0, 0.5 * best_score / max(total, 1) + 0.5 * margin / best_score))
    return best_category, round(confidence, 4), scores


@lru_cache(maxsize=1)
def _load_captioner():
    if os.getenv("MEMORYOS_ENABLE_VISION_MODEL", "0") != "1":
        return None
    try:
        from transformers import BlipForConditionalGeneration, BlipProcessor
    except ImportError:
        return None

    model_name = os.getenv("MEMORYOS_VISION_MODEL", "Salesforce/blip-image-captioning-base")
    return (
        BlipProcessor.from_pretrained(model_name),
        BlipForConditionalGeneration.from_pretrained(model_name),
    )


def _describe_image(image) -> str:
    captioner = _load_captioner()
    if captioner is None:
        return ""
    processor, model = captioner
    inputs = processor(images=image, return_tensors="pt")
    output = model.generate(**inputs, max_new_tokens=40)
    return processor.decode(output[0], skip_special_tokens=True)


@lru_cache(maxsize=1)
def _load_ocr():
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        return None

    return PaddleOCR(
        lang=os.getenv("MEMORYOS_OCR_LANGUAGE", "en"),
        use_doc_orientation_classify=True,
        use_doc_unwarping=False,
        use_textline_orientation=True,
    )


def _read_paddle_result(result):
    texts = []
    scores = []
    for item in result or []:
        data = item.json if hasattr(item, "json") else item
        if isinstance(data, str):
            import json
            data = json.loads(data)
        data = data.get("res", data) if isinstance(data, dict) else {}
        texts.extend(str(text) for text in data.get("rec_texts", []) if text)
        scores.extend(float(score) for score in data.get("rec_scores", []) if score is not None)
    return "\n".join(texts).strip(), (sum(scores) / len(scores) if scores else 0.0)


def _extract_ocr(image):
    try:
        engine = _load_ocr()
        if engine is None:
            return "", 0.0, "failed"
        result = engine.predict(np.asarray(image))
        text, confidence = _read_paddle_result(result)
        if text:
            return text, round(confidence, 4), "complete"

        # Enhancement is a retry for faint scans, rather than a transformation of every image.
        enhanced = ImageOps.grayscale(image)
        enhanced = ImageEnhance.Contrast(enhanced).enhance(1.8).filter(ImageFilter.MedianFilter(3))
        text, confidence = _read_paddle_result(engine.predict(np.asarray(enhanced.convert("RGB"))))
        return text, round(confidence, 4), "complete"
    except Exception:
        return "", 0.0, "failed"


def classify_image(image, filename: str, mime_type: str) -> dict:
    ocr_text, ocr_confidence, ocr_status = _extract_ocr(image)
    visual_description = _describe_image(image)
    category, confidence, _ = classify_text(filename, ocr_text, visual_description)
    source_tokens = _tokens(f"{filename} {ocr_text} {visual_description}")
    return {
        "filename": filename,
        "mime_type": mime_type,
        "category": category,
        "confidence": confidence,
        "ocr_text": ocr_text,
        "ocr_confidence": ocr_confidence,
        "ocr_status": ocr_status,
        "visual_description": visual_description,
        "keywords": ", ".join(sorted(source_tokens)),
    }
