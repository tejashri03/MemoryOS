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
        "phrases": {"aadhaar card": 12, "pan card": 12, "driving licence": 12, "driving license": 12, "driver license": 12, "voter id": 12, "id card": 10, "identity card": 12, "id proof": 12, "identity proof": 12, "government id": 12, "national id": 12, "passport number": 10, "passport issued by": 12},
        "keywords": {"aadhaar": 9, "passport": 7, "voter": 7, "licence": 7, "license": 7, "pan": 4, "uidai": 9, "election": 5},
        "weak": {"identity": 1, "government": 1, "dob": 1, "address": 1, "id": 0.5},
        "avoid": {"boarding pass": 12, "flight ticket": 10, "hotel booking": 8, "assignment": 8, "invoice": 8, "receipt": 8},
    },
    "Education": {
        "phrases": {"mark sheet": 12, "marksheet": 12, "bachelor of engineering": 13, "degree certificate": 12, "engineering certificate": 12, "academic transcript": 12, "report card": 11, "school certificate": 11, "admit card": 10, "university of": 8},
        "keywords": {"certificate": 5, "degree": 7, "diploma": 8, "university": 8, "college": 7, "semester": 7, "thesis": 7, "cgpa": 8, "marksheet": 10},
        "weak": {"student": 1, "exam": 1, "course": 1, "assignment": 1, "grade": 1, "school": 1},
        "avoid": {"birth certificate": 8, "medical certificate": 6, "certificate of insurance": 5},
    },
    "Medical & Health": {
        "phrases": {"medical report": 12, "blood test": 12, "blood pressure": 10, "doctor note": 10, "discharge summary": 13, "lab report": 11, "medical prescription": 13},
        "keywords": {"prescription": 9, "hospital": 8, "doctor": 8, "patient": 8, "diagnosis": 9, "medicine": 7, "pharmacy": 7, "dosage": 8, "hemoglobin": 9, "radiology": 8},
        "weak": {"health": 1, "medical": 2, "symptom": 1},
        "avoid": {"health insurance": 3, "restaurant": 4},
    },
    "Finance": {
        "phrases": {"bank statement": 13, "account statement": 13, "income certificate": 12, "income cert": 12, "income tax return": 13, "tax return": 12, "credit card statement": 12, "mutual fund": 10, "account number": 8},
        "keywords": {"ifsc": 10, "neft": 9, "rtgs": 9, "cheque": 8, "investment": 8, "salary": 7, "transaction": 5, "balance": 5, "bank": 5},
        "weak": {"tax": 1, "income": 1, "payment": 1, "amount": 0.5},
        "avoid": {"receipt": 4, "invoice": 4, "utility bill": 5},
    },
    "Bills & Receipts": {
        "phrases": {"tax invoice": 10, "purchase receipt": 10, "order total": 8, "amount due": 9, "invoice number": 10, "utility bill": 10, "payment receipt": 9},
        "keywords": {"receipt": 9, "invoice": 9, "subtotal": 8, "gst": 8, "barcode": 6, "quantity": 5, "discount": 6},
        "weak": {"bill": 2, "total": 1, "amount": 1, "payment": 1, "due": 1},
        "avoid": {"bank statement": 5, "medical bill": 3},
    },
    "Work & Professional": {
        "phrases": {"offer letter": 12, "cover letter": 11, "job application": 11, "employment contract": 12, "experience letter": 11, "business card": 10, "meeting minutes": 9},
        "keywords": {"resume": 10, "curriculum": 8, "employment": 8, "linkedin": 8, "payroll": 6, "designation": 6},
        "weak": {"company": 1, "employee": 1, "office": 0.5, "client": 1, "project": 1, "agenda": 1},
        "avoid": {"school project": 5},
    },
    "Travel": {
        "phrases": {"boarding pass": 13, "flight ticket": 12, "train ticket": 12, "travel ticket": 11, "hotel booking": 12, "travel itinerary": 12, "booking confirmation": 9, "car rental": 10},
        "keywords": {"airline": 9, "airport": 8, "itinerary": 9, "departure": 7, "arrival": 7, "airbnb": 8, "vacation": 6, "tourist": 5},
        "weak": {"flight": 1, "boarding": 2, "train": 1, "hotel": 1, "trip": 1},
        "avoid": {"passport number": 5, "passport photo": 7},
    },
    "Events & Celebrations": {
        "phrases": {"birthday party": 11, "wedding invitation": 12, "save the date": 11, "baby shower": 11, "wedding ceremony": 10, "event invitation": 10},
        "keywords": {"birthday": 8, "wedding": 8, "festival": 7, "celebration": 8, "christmas": 7, "diwali": 7, "invitation": 8, "anniversary": 8, "ceremony": 6},
        "weak": {"party": 2, "cake": 1},
        "avoid": {"party receipt": 4},
    },
    "People & Family": {
        "phrases": {"family photo": 11, "family portrait": 11, "group photo": 10, "wedding photo": 8, "self portrait": 9},
        "keywords": {"family": 9, "portrait": 9, "friend": 6, "selfie": 9, "child": 6, "baby": 5},
        "weak": {"person": 0.5, "people": 0.5, "face": 0.5, "group": 1},
        "avoid": {"profile screenshot": 6},
    },
    "Nature & Places": {
        "phrases": {"city skyline": 10, "national park": 10, "tourist attraction": 9, "street view": 9, "landscape photo": 9},
        "keywords": {"mountain": 8, "beach": 7, "landscape": 9, "sunset": 8, "lake": 8, "river": 7, "monument": 9, "forest": 8, "waterfall": 9, "skyline": 8},
        "weak": {"building": 1, "city": 1, "nature": 1, "place": 1},
        "avoid": {"beach vacation": 3, "hotel": 3},
    },
    "Animals & Pets": {
        "phrases": {"pet dog": 11, "pet cat": 11, "animal shelter": 10, "wildlife photo": 10},
        "keywords": {"dog": 10, "cat": 10, "bird": 9, "pet": 9, "horse": 9, "wildlife": 10, "animal": 9, "puppy": 10, "kitten": 10},
        "weak": {"zoo": 2},
        "avoid": {"hot dog": 8},
    },
    "Food & Drinks": {
        "phrases": {"food menu": 10, "restaurant receipt": 10, "meal photo": 10, "coffee cup": 9},
        "keywords": {"food": 8, "dish": 7, "meal": 8, "lunch": 7, "dinner": 7, "breakfast": 7, "coffee": 8, "tea": 7, "pizza": 9, "sushi": 9, "burger": 8, "beverage": 8},
        "weak": {"restaurant": 1, "menu": 1, "drink": 1},
        "avoid": {"receipt": 2},
    },
    "Screenshots": {
        "phrases": {"screen capture": 12, "mobile screenshot": 12, "chat screenshot": 12, "error message": 9, "browser window": 9},
        "keywords": {"screenshot": 12, "whatsapp": 10, "browser": 8, "notification": 7, "url": 6},
        "weak": {"screen": 1, "capture": 1, "mobile": 1, "application": 0.5, "app": 0.5, "website": 1, "chat": 1},
        "avoid": {},
    },
    "Notes & Documents": {
        "phrases": {"handwritten note": 11, "meeting notes": 8, "scanned document": 11, "white board": 10, "legal document": 9},
        "keywords": {"handwritten": 10, "handwriting": 10, "whiteboard": 10, "memo": 8},
        "weak": {"note": 2, "document": 0.5, "paper": 0.5, "scanned": 1, "text": 0.25, "signature": 1},
        "avoid": {"identity document": 6, "travel document": 5, "medical report": 6},
    },
    "Others": {"phrases": {}, "keywords": {}, "weak": {}, "avoid": {}},
}


def _tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", _normalise(value)))


def _normalise(value: str) -> str:
    value = re.sub(r"([a-z])([A-Z])", r"\1 \2", value or "")
    value = value.lower().replace("0", "o") if value.lower().count("0") > 2 else value.lower()
    return re.sub(r"[^a-z0-9]+", " ", value).strip()


def _phrase_present(text: str, phrase: str) -> bool:
    return re.search(rf"\b{re.escape(_normalise(phrase))}\b", text) is not None


def _score_profile(profile: dict, filename: str, ocr_text: str, visual_description: str, ocr_confidence: float) -> dict[str, float]:
    components = {"ocr": 0.0, "visual": 0.0, "metadata": 0.0}
    evidence = {"ocr": [], "visual": [], "metadata": []}
    sources = ((filename, 1.5, "metadata"), (ocr_text, 4.0 * max(0.0, min(1.0, ocr_confidence)), "ocr"), (visual_description, 2.5, "visual"))
    for value, source_weight, source_name in sources:
        text = _normalise(value)
        if not text:
            continue
        token_values = _tokens(text)
        for phrase, weight in profile["phrases"].items():
            if _phrase_present(text, phrase):
                contribution = weight * source_weight
                components[source_name] += contribution
                evidence[source_name].append({"match": phrase, "strength": "strong", "weight": round(contribution, 2)})
        for keyword, weight in profile["keywords"].items():
            if _normalise(keyword) in token_values:
                contribution = weight * source_weight
                components[source_name] += contribution
                evidence[source_name].append({"match": keyword, "strength": "strong", "weight": round(contribution, 2)})
        for keyword, weight in profile.get("weak", {}).items():
            if _normalise(keyword) in token_values:
                contribution = weight * source_weight
                components[source_name] += contribution
                evidence[source_name].append({"match": keyword, "strength": "weak", "weight": round(contribution, 2)})
        for phrase, penalty in profile["avoid"].items():
            if _phrase_present(text, phrase):
                contribution = penalty * source_weight
                components[source_name] -= contribution
                evidence[source_name].append({"match": phrase, "strength": "conflict", "weight": round(-contribution, 2)})
    components = {key: value for key, value in components.items()}
    return {**components, "total": max(sum(components.values()), 0.0), "matches": evidence}


def classify_text_detailed(filename: str, ocr_text: str = "", visual_description: str = "", ocr_confidence: float = 1.0, semantic_scores: dict[str, float] | None = None) -> dict:
    """Classify evidence with normalized source contributions and review signals."""
    evidence = {
        category: _score_profile(profile, filename, ocr_text, visual_description, ocr_confidence)
        for category, profile in PROFILES.items()
    }
    raw_scores = {category: values["total"] for category, values in evidence.items()}
    max_raw = max(raw_scores.values(), default=0.0)
    scores = {}
    for category, values in evidence.items():
        # OpenCLIP values arrive as (cosine + 1) / 2. Remove the shared baseline
        # so generic similarity across every label cannot create false certainty.
        clip_value = max(0.0, min(1.0, (semantic_scores or {}).get(category, 0.0)))
        semantic = max(0.0, min(1.0, (clip_value - 0.5) * 5.0))
        lexical = values["total"] / max(max_raw, 1.0)
        scores[category] = round(lexical * 0.75 + semantic * 0.25, 6)
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
    # High precision document cues resolve known collisions, while their OCR
    # contribution still respects the OCR engine's confidence.
    ocr_factor = max(0.0, min(1.0, ocr_confidence))
    if any(_phrase_present(_normalise(f"{filename} {visual_description}"), marker) for marker in receipt_markers) or any(_phrase_present(_normalise(ocr_text), marker) for marker in receipt_markers) and ocr_factor >= 0.35:
        scores["Bills & Receipts"] += 0.28 if ocr_factor >= 0.35 else 0.12
    if any(_phrase_present(_normalise(f"{filename} {visual_description}"), marker) for marker in finance_markers) or any(_phrase_present(_normalise(ocr_text), marker) for marker in finance_markers) and ocr_factor >= 0.35:
        scores["Finance"] += 0.28 if ocr_factor >= 0.35 else 0.12
    if any(_phrase_present(_normalise(f"{filename} {visual_description}"), marker) for marker in identity_markers) or any(_phrase_present(_normalise(ocr_text), marker) for marker in identity_markers) and ocr_factor >= 0.35:
        scores["Government & Identity"] += 0.28 if ocr_factor >= 0.35 else 0.12

    ranked = sorted(scores.items(), key=lambda item: item[1], reverse=True)
    best_category, best_score = ranked[0]
    second_score = ranked[1][1]
    margin = best_score - second_score
    conflicting_evidence = (
        ("passport" in combined_text and "certificate" in combined_text)
        or ("receipt" in combined_text and "bank statement" in combined_text)
        or ("medical" in combined_text and "insurance" in combined_text)
    )
    semantic_peak = max((max(0.0, min(1.0, (value - 0.5) * 5.0)) for value in (semantic_scores or {}).values()), default=0.0)
    has_strong_text = max_raw >= 5.0
    weak_signal = best_score < 0.18 or (not has_strong_text and semantic_peak < 0.65)
    ambiguous = weak_signal or margin < 0.06 or conflicting_evidence
    confidence = min(0.99, max(0.0, 0.65 * best_score + 0.35 * min(1.0, margin * 4)))
    confidence *= 0.75 + 0.25 * max(0.0, min(1.0, ocr_confidence))
    category = "Others" if ambiguous else best_category
    subcategory = infer_subcategory(category if not ambiguous else best_category, combined_text)
    return {
        "category": category,
        "subcategory": subcategory,
        "confidence": round(0.0 if ambiguous else confidence, 4),
        "ambiguous": ambiguous,
        "score_margin": round(margin, 4),
        "processing_status": "needs_review" if ambiguous else "completed",
        "candidates": [{"category": name, "score": round(score, 4)} for name, score in ranked[:3]],
        "scores": scores,
        "evidence": evidence,
    }


def classify_text(filename: str, ocr_text: str = "", visual_description: str = "", ocr_confidence: float = 1.0) -> tuple[str, float, dict[str, float]]:
    result = classify_text_detailed(filename, ocr_text, visual_description, ocr_confidence)
    return result["category"], result["confidence"], result["scores"]


def infer_subcategory(category: str, text: str) -> str | None:
    rules = {
        "Education": (("Certificate", ("certificate", "degree", "diploma")), ("Marksheet", ("marksheet", "mark sheet", "transcript", "grade")), ("Assignment", ("assignment", "thesis")), ("Notes", ("notes", "lecture", "notebook"))),
        "Government & Identity": (("Aadhaar", ("aadhaar",)), ("PAN", ("pan card",)), ("Passport", ("passport",)), ("Driving Licence", ("driving licence", "driver license"))),
        "Medical & Health": (("Prescription", ("prescription", "dosage", "pharmacy")), ("Medical Report", ("medical report", "lab report", "blood test", "diagnosis"))),
        "Finance": (("Bank Statement", ("bank statement", "account statement", "ifsc")), ("Tax", ("tax return", "income tax", "pan")), ("Investment", ("mutual fund", "investment"))),
        "Bills & Receipts": (("Electricity", ("electricity", "power bill")), ("Internet", ("internet bill", "broadband")), ("Shopping", ("shopping", "purchase receipt", "retail")), ("Restaurant", ("restaurant receipt", "food menu"))),
        "Work & Professional": (("Resume", ("resume", "curriculum vitae")), ("Offer Letter", ("offer letter",)), ("Business Card", ("business card",)), ("Meeting Notes", ("meeting notes", "meeting minutes"))),
        "Travel": (("Ticket", ("ticket", "train")), ("Boarding Pass", ("boarding pass",)), ("Hotel", ("hotel", "booking")), ("Destination Photo", ("beach", "mountain", "landscape"))),
        "Events & Celebrations": (("Birthday", ("birthday",)), ("Wedding", ("wedding",)), ("Festival", ("festival", "diwali", "christmas")), ("Invitation", ("invitation", "save the date"))),
        "People & Family": (("Family", ("family",)), ("Portrait", ("portrait", "selfie")), ("Group Photo", ("group photo", "friends"))),
        "Nature & Places": (("Beach", ("beach", "ocean", "coast")), ("Mountain", ("mountain",)), ("City", ("city", "skyline")), ("Nature", ("forest", "lake", "river", "waterfall"))),
        "Animals & Pets": (("Dog", ("dog", "puppy")), ("Cat", ("cat", "kitten")), ("Bird", ("bird",))),
        "Food & Drinks": (("Meal", ("meal", "food", "lunch", "dinner")), ("Drinks", ("coffee", "tea", "drink"))),
        "Screenshots": (("Chat", ("chat", "whatsapp", "message")), ("Mobile App", ("mobile", "phone", "app")), ("Web Page", ("browser", "website", "url"))),
        "Notes & Documents": (("Handwritten Notes", ("handwritten", "handwriting", "notebook")), ("Meeting Notes", ("meeting notes", "meeting minutes")), ("Scanned Document", ("scanned document", "scanned"))),
        "Others": (("Uncategorized", ()),),
    }
    for name, markers in rules.get(category, ()):
        if any(_phrase_present(text, marker) for marker in markers):
            return name
    return None


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


def classify_image(image, filename: str, mime_type: str, image_embedding=None, semantic_scores: dict[str, float] | None = None) -> dict:
    ocr_text, ocr_confidence, ocr_status = _extract_ocr(image)
    visual_description = _describe_image(image)
    detailed = classify_text_detailed(filename, ocr_text, visual_description, ocr_confidence, semantic_scores)
    source_tokens = _tokens(f"{filename} {ocr_text} {visual_description}")
    return {
        "filename": filename,
        "mime_type": mime_type,
        "category": detailed["category"],
        "subcategory": detailed["subcategory"],
        "confidence": detailed["confidence"],
        "ambiguous": detailed["ambiguous"],
        "processing_status": detailed["processing_status"],
        "classification_candidates": detailed["candidates"],
        "classification_scores": detailed["scores"],
        "classification_evidence": detailed["evidence"],
        "classification_margin": detailed["score_margin"],
        "ocr_text": ocr_text,
        "ocr_confidence": ocr_confidence,
        "ocr_status": ocr_status,
        "visual_description": visual_description,
        "keywords": ", ".join(sorted(source_tokens)),
    }
