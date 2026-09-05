import os
import re
from functools import lru_cache

import pytesseract

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

KEYWORDS = {
    "Government & Identity": "aadhaar pan card passport driving licence driver license identity id card voter election birth certificate",
    "Education": "certificate degree diploma marksheet mark sheet transcript university college school assignment exam classroom thesis student",
    "Medical & Health": "prescription medical report hospital doctor medicine patient diagnosis pharmacy health blood laboratory",
    "Finance": "bank account tax income salary statement transaction payment cheque loan investment finance",
    "Bills & Receipts": "receipt invoice bill electricity water shopping purchase total amount due gst barcode",
    "Work & Professional": "resume cv offer letter employment office company employee professional meeting business linkedin",
    "Travel": "flight boarding pass ticket train hotel booking airport passport itinerary beach mountain trip vacation travel",
    "Events & Celebrations": "birthday wedding party festival celebration christmas diwali ceremony invitation cake",
    "People & Family": "person people family portrait friend group face selfie",
    "Nature & Places": "mountain beach landscape sunset lake river building city monument nature forest",
    "Animals & Pets": "dog cat bird pet horse wildlife animal puppy kitten",
    "Food & Drinks": "food restaurant dish meal lunch dinner breakfast coffee tea drink beverage pizza",
    "Screenshots": "screenshot screen capture mobile application app website chat whatsapp browser",
    "Notes & Documents": "note handwritten handwriting whiteboard document scanned paper memo text",
}


def _tokens(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]+", value.lower()))


@lru_cache(maxsize=1)
def _load_captioner():
    if os.getenv("MEMORYOS_ENABLE_VISION_MODEL", "0") != "1":
        return None
    from transformers import BlipForConditionalGeneration, BlipProcessor

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


def classify_image(image, filename: str, mime_type: str) -> dict:
    ocr_text = pytesseract.image_to_string(image).strip()
    visual_description = _describe_image(image)
    source = f"{filename} {ocr_text} {visual_description}".lower()
    source_tokens = _tokens(source)
    scores = {
        category: len(source_tokens & _tokens(keywords))
        for category, keywords in KEYWORDS.items()
    }

    # Screenshot and document signals should win when OCR finds readable UI or paperwork.
    if re.search(r"screenshot|screen.?capture|whatsapp|browser|mobile", source):
        scores["Screenshots"] += 4
    if re.search(r"certificate|marksheet|degree|diploma|transcript", source):
        scores["Education"] += 4
    if re.search(r"prescription|diagnosis|hospital|patient", source):
        scores["Medical & Health"] += 4

    category = max(scores, key=scores.get)
    if scores[category] == 0:
        category = "Others"
    total = sum(scores.values())
    confidence = round(scores[category] / total, 4) if total else 0.0
    return {
        "filename": filename,
        "mime_type": mime_type,
        "category": category,
        "confidence": confidence,
        "ocr_text": ocr_text,
        "visual_description": visual_description,
    }
