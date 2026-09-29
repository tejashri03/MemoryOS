import os
from functools import lru_cache

import numpy as np

CLASSIFICATION_PROMPTS = (
    "A government identity document such as an Aadhaar card, passport, PAN card, voter ID, or driving licence",
    "An education document such as a university certificate, engineering degree, marksheet, transcript, or college notes",
    "A medical document such as a prescription, hospital report, lab result, or health record",
    "A personal finance document such as a bank statement, tax return, investment, or account record",
    "A bill, invoice, store receipt, or utility payment document",
    "A work document such as a resume, offer letter, business card, or professional meeting record",
    "Travel memories including boarding passes, train tickets, hotels, landmarks, and vacation photos",
    "A celebration or event such as a birthday, wedding, festival, or invitation",
    "A photograph of family, friends, people, or a portrait",
    "A photo of nature or a place such as a beach, mountain, landscape, city, or monument",
    "A photo of an animal or pet such as a dog, cat, bird, or wildlife",
    "A photo of food, a meal, a dish, coffee, or drinks",
    "A screenshot of a phone, app, website, browser, chat, or computer screen",
    "A handwritten note, scanned page, whiteboard, or general document",
    "An image without enough evidence to assign it to another category",
)

CLASSIFICATION_CATEGORIES = (
    "Government & Identity", "Education", "Medical & Health", "Finance", "Bills & Receipts",
    "Work & Professional", "Travel", "Events & Celebrations", "People & Family",
    "Nature & Places", "Animals & Pets", "Food & Drinks", "Screenshots", "Notes & Documents", "Others",
)


@lru_cache(maxsize=1)
def _load_openclip():
    if os.getenv("MEMORYOS_ENABLE_CLIP", "1") != "1":
        return None
    try:
        import open_clip
        import torch
    except ImportError:
        return None

    model_name = os.getenv("MEMORYOS_CLIP_MODEL", "ViT-B-32")
    pretrained = os.getenv("MEMORYOS_CLIP_PRETRAINED", "laion2b_s34b_b79k")
    model, _, preprocess = open_clip.create_model_and_transforms(model_name, pretrained=pretrained)
    tokenizer = open_clip.get_tokenizer(model_name)
    model.eval()
    return model, preprocess, tokenizer, torch


def generate_image_embedding(image):
    loaded = _load_openclip()
    if loaded is None:
        return None
    model, preprocess, _, torch = loaded
    with torch.inference_mode():
        vector = model.encode_image(preprocess(image).unsqueeze(0))
        vector = vector / vector.norm(dim=-1, keepdim=True)
    return vector[0].cpu().numpy().astype(np.float32)


def generate_text_embedding(query):
    loaded = _load_openclip()
    if loaded is None:
        return None
    model, _, tokenizer, torch = loaded
    with torch.inference_mode():
        vector = model.encode_text(tokenizer([query]))
        vector = vector / vector.norm(dim=-1, keepdim=True)
    return vector[0].cpu().numpy().astype(np.float32)


@lru_cache(maxsize=1)
def _classification_embeddings():
    loaded = _load_openclip()
    if loaded is None:
        return None
    model, _, tokenizer, torch = loaded
    with torch.inference_mode():
        vectors = model.encode_text(tokenizer(list(CLASSIFICATION_PROMPTS)))
        vectors = vectors / vectors.norm(dim=-1, keepdim=True)
    return vectors.cpu().numpy().astype(np.float32)


def generate_category_scores(image_embedding):
    labels = _classification_embeddings()
    if image_embedding is None or labels is None:
        return {}
    vector = np.asarray(image_embedding, dtype=np.float32)
    norm = np.linalg.norm(vector)
    if not norm:
        return {}
    similarities = np.dot(labels, vector / norm)
    return {category: float((score + 1.0) / 2.0) for category, score in zip(CLASSIFICATION_CATEGORIES, similarities)}


def calculate_similarity(image_embedding, query_embedding):
    if image_embedding is None or query_embedding is None:
        return 0.0
    image_vector = np.asarray(image_embedding, dtype=np.float32)
    query_vector = np.asarray(query_embedding, dtype=np.float32)
    image_norm = np.linalg.norm(image_vector)
    query_norm = np.linalg.norm(query_vector)
    if not image_norm or not query_norm:
        return 0.0
    return float(np.dot(image_vector, query_vector) / (image_norm * query_norm))
