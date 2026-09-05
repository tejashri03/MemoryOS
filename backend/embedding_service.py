import os
from functools import lru_cache

import numpy as np


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
