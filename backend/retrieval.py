import json
import re
from datetime import datetime, timezone
from math import exp

import numpy as np

from embedding_service import calculate_similarity


STOP_WORDS = {
    "a", "an", "and", "are", "at", "by", "find", "for", "from", "get", "in",
    "is", "me", "my", "of", "on", "or", "please", "search", "show", "the", "to", "with",
}
DOCUMENT_TERMS = {
    "account", "amount", "bill", "card", "certificate", "document", "invoice",
    "number", "receipt", "statement", "text", "transaction",
}
VISUAL_TERMS = {
    "animal", "beach", "bird", "cat", "color", "dog", "food", "garden", "image",
    "landscape", "mountain", "photo", "photos", "picture", "pictures", "portrait",
    "scene", "sunset", "visual",
}


def query_tokens(value: str) -> set[str]:
    return {token for token in re.findall(r"[a-z0-9]+", (value or "").lower()) if token not in STOP_WORDS}


def adaptive_weights(query: str, semantic_available: bool = True) -> dict[str, float]:
    weights = {
        "full_text": 0.10,
        "ocr": 0.20,
        "caption": 0.13,
        "keywords": 0.13,
        "classifier_keywords": 0.18,
        "metadata": 0.06,
        "semantic": 0.20 if semantic_available else 0.0,
    }
    terms = query_tokens(query)
    document_query = bool(terms.intersection(DOCUMENT_TERMS)) or bool(re.search(r"\d", query))
    visual_query = bool(terms.intersection(VISUAL_TERMS))

    if document_query:
        weights["ocr"] += 0.12
        weights["full_text"] += 0.08
        weights["semantic"] = max(0.0, weights["semantic"] - 0.16)
        weights["caption"] = max(0.0, weights["caption"] - 0.04)
    elif visual_query:
        if semantic_available:
            weights["semantic"] += 0.14
        else:
            weights["keywords"] += 0.08
        weights["caption"] += 0.08
        weights["ocr"] = max(0.0, weights["ocr"] - 0.12)
        weights["full_text"] = max(0.0, weights["full_text"] - 0.10)

    total = sum(weights.values())
    if total:
        return {name: weight / total for name, weight in weights.items()}
    return weights


def evidence_adaptive_weights(
    query: str,
    evidence: list[dict[str, float]],
    semantic_available: bool = True,
) -> dict[str, float]:
    base_weights = adaptive_weights(query, semantic_available)
    if not evidence:
        return base_weights

    adjusted = {}
    for signal, base_weight in base_weights.items():
        strongest = sorted((max(0.0, min(1.0, row.get(signal, 0.0))) for row in evidence), reverse=True)[:5]
        reliability = sum(strongest) / len(strongest) if strongest else 0.0
        adjusted[signal] = base_weight * (0.5 + reliability)
    total = sum(adjusted.values())
    return {signal: weight / total for signal, weight in adjusted.items()} if total else base_weights


def normalize_text_score(value: float) -> float:
    value = max(float(value or 0.0), 0.0)
    return value / (value + 1.0)


def token_overlap(query: str, text: str) -> float:
    terms = query_tokens(query)
    if not terms:
        return 0.0
    return len(terms.intersection(query_tokens(text))) / len(terms)


def classifier_keyword_overlap(query: str, evidence) -> float:
    terms = query_tokens(query)
    if not terms or not evidence:
        return 0.0
    if isinstance(evidence, str):
        try:
            evidence = json.loads(evidence)
        except json.JSONDecodeError:
            return 0.0
    if not isinstance(evidence, dict):
        return 0.0

    strongest_match = 0.0
    for category_evidence in evidence.values():
        matches = category_evidence.get("matches", {}) if isinstance(category_evidence, dict) else {}
        for source_matches in matches.values():
            for match in source_matches:
                if not isinstance(match, dict) or match.get("strength") == "conflict":
                    continue
                overlap = len(terms.intersection(query_tokens(match.get("match", "")))) / len(terms)
                if match.get("strength") == "weak":
                    overlap *= 0.5
                strongest_match = max(strongest_match, overlap)
    return strongest_match


def score_candidate(
    query: str,
    item: dict,
    semantic_similarity: float,
    text_score: float,
    semantic_available: bool,
    weights: dict[str, float] | None = None,
) -> dict:
    weights = weights or adaptive_weights(query, semantic_available)
    signals = {
        "full_text": normalize_text_score(text_score),
        "ocr": token_overlap(query, item.get("ocr_text", ""))
        * max(0.0, min(1.0, float(item.get("ocr_confidence") or 0.0))),
        "caption": token_overlap(query, item.get("visual_description", "")),
        "keywords": token_overlap(query, item.get("keywords", "")),
        "classifier_keywords": classifier_keyword_overlap(
            query, item.get("classification_evidence", {})
        ),
        "metadata": token_overlap(
            query,
            " ".join(
                str(item.get(field) or "")
                for field in ("filename", "category", "subcategory", "location")
            ),
        ),
        "semantic": max(0.0, min(1.0, float(semantic_similarity or 0.0)))
        if semantic_available
        else 0.0,
    }
    score = sum(signals[name] * weights[name] for name in weights)
    return {"score": round(score, 6), "signals": signals, "weights": weights}


def is_relevant_candidate(signals: dict[str, float], score: float) -> bool:
    if score < 0.10:
        return False
    lexical_match = max(
        (signals.get(name, 0.0) for name in (
            "full_text", "ocr", "caption", "keywords", "classifier_keywords", "metadata"
        )),
        default=0.0,
    )
    return lexical_match >= 0.75 or signals.get("semantic", 0.0) >= 0.80


def find_duplicate_groups(images: list[dict], visual_threshold: float = 0.85, max_hamming: int = 6) -> list[dict]:
    parents = list(range(len(images)))
    ranks = [0] * len(images)
    component_similarity = [100] * len(images)

    def find(index: int) -> int:
        while parents[index] != index:
            parents[index] = parents[parents[index]]
            index = parents[index]
        return index

    def union(left: int, right: int, similarity: int) -> None:
        left_root = find(left)
        right_root = find(right)
        if left_root == right_root:
            component_similarity[left_root] = min(component_similarity[left_root], similarity)
            return
        if ranks[left_root] < ranks[right_root]:
            left_root, right_root = right_root, left_root
        parents[right_root] = left_root
        component_similarity[left_root] = min(
            component_similarity[left_root], component_similarity[right_root], similarity
        )
        if ranks[left_root] == ranks[right_root]:
            ranks[left_root] += 1

    exact_hash_roots = {}
    for index, image in enumerate(images):
        file_hash = image.get("file_hash")
        if file_hash:
            if file_hash in exact_hash_roots:
                union(index, exact_hash_roots[file_hash], 100)
            else:
                exact_hash_roots[file_hash] = index

    fingerprints = []
    for image in images:
        try:
            fingerprints.append(int(image.get("phash") or "", 16))
        except ValueError:
            fingerprints.append(None)

    hash_root = None
    hash_children = {}
    for index, value in enumerate(fingerprints):
        if value is None:
            continue
        if hash_root is None:
            hash_root = index
            hash_children[index] = {}
            continue
        pending = [hash_root]
        while pending:
            candidate_index = pending.pop()
            candidate_value = fingerprints[candidate_index]
            distance = (value ^ candidate_value).bit_count()
            if distance <= max_hamming:
                union(index, candidate_index, round((64 - distance) / 64 * 100))
            pending.extend(
                child for edge, child in hash_children[candidate_index].items()
                if distance - max_hamming <= edge <= distance + max_hamming
            )
        node = hash_root
        while True:
            edge = (value ^ fingerprints[node]).bit_count()
            if edge in hash_children[node]:
                node = hash_children[node][edge]
            else:
                hash_children[node][edge] = index
                hash_children[index] = {}
                break

    embeddings_by_dimensions = {}
    for index, image in enumerate(images):
        embedding = image.get("image_embedding")
        if embedding is None:
            continue
        vector = np.asarray(embedding, dtype=np.float32).reshape(-1)
        norm = np.linalg.norm(vector)
        if not norm:
            continue
        embeddings_by_dimensions.setdefault(vector.size, []).append((index, vector / norm))

    for entries in embeddings_by_dimensions.values():
        indices = [entry[0] for entry in entries]
        vectors = np.stack([entry[1] for entry in entries])
        for start in range(0, len(entries), 256):
            stop = min(start + 256, len(entries))
            similarities = vectors[start:stop] @ vectors.T
            rows, columns = np.nonzero(similarities >= visual_threshold)
            for row, column in zip(rows, columns):
                left = start + int(row)
                right = int(column)
                if right > left:
                    score = round(min(float(similarities[row, column]), 1.0) * 100)
                    union(indices[left], indices[right], score)

    components = {}
    for index, image in enumerate(images):
        root = find(index)
        components.setdefault(root, []).append(index)

    groups = []
    for root, indices in components.items():
        if len(indices) < 2:
            continue
        index_set = set(indices)
        items = [
            {key: value for key, value in images[index].items() if key != "image_embedding"}
            for index in indices
        ]
        hashes = {item.get("file_hash") for item in items}
        groups.append({
            "fingerprint": items[0].get("phash") or str(items[0].get("id")),
            "type": "exact_duplicate" if len(hashes) == 1 and None not in hashes else "near_duplicate",
            "similarity": component_similarity[find(indices[0])],
            "items": items,
        })
    return groups


def _as_datetime(value):
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def contextual_links(target: dict, candidates: list[dict], limit: int = 8) -> list[dict]:
    target_date = _as_datetime(target.get("file_modified_at") or target.get("created_at"))
    target_location = query_tokens(target.get("location", ""))
    target_visual = query_tokens(
        f"{target.get('visual_description', '')} {target.get('keywords', '')}"
    )
    links = []

    for candidate in candidates:
        if candidate.get("id") == target.get("id"):
            continue
        reasons = []
        components = {}
        candidate_date = _as_datetime(candidate.get("file_modified_at") or candidate.get("created_at"))
        if target_date and candidate_date:
            days_apart = abs((target_date - candidate_date).total_seconds()) / 86400
            components["time"] = exp(-days_apart / 30)
            if days_apart <= 7:
                reasons.append("Same week")
            elif days_apart <= 30:
                reasons.append("Nearby date")

        candidate_location = query_tokens(candidate.get("location", ""))
        if target_location and candidate_location:
            place_match = len(target_location & candidate_location) / len(target_location | candidate_location)
            components["place"] = place_match
            if place_match >= 0.5:
                reasons.append("Same place")

        category_match = target.get("category") == candidate.get("category")
        subcategory_match = bool(
            target.get("subcategory") and target.get("subcategory") == candidate.get("subcategory")
        )
        components["category"] = 1.0 if category_match else 0.0
        if category_match:
            reasons.append("Same category")
        if subcategory_match:
            components["category"] = 1.0
            reasons.append("Same subcategory")

        candidate_visual = query_tokens(
            f"{candidate.get('visual_description', '')} {candidate.get('keywords', '')}"
        )
        if target_visual and candidate_visual:
            overlap = len(target_visual & candidate_visual) / len(target_visual | candidate_visual)
            components["visual_terms"] = overlap
            if overlap >= 0.15:
                reasons.append("Shared visual details")

        semantic_similarity = calculate_similarity(
            target.get("image_embedding"), candidate.get("image_embedding")
        )
        if semantic_similarity > 0:
            components["visual_similarity"] = max(0.0, min(1.0, (semantic_similarity - 0.15) / 0.3))
            if semantic_similarity >= 0.75:
                reasons.append("Similar visual content")

        signal_weights = {
            "time": 0.18,
            "place": 0.2,
            "category": 0.18,
            "visual_terms": 0.22,
            "visual_similarity": 0.22,
        }
        available_weight = sum(signal_weights[name] for name in components)
        score = sum(components[name] * signal_weights[name] for name in components) / available_weight if available_weight else 0
        if score >= 0.18:
            links.append({
                "image": {key: value for key, value in candidate.items() if key != "image_embedding"},
                "score": round(score, 4),
                "reasons": list(dict.fromkeys(reasons)),
                "signals": {name: round(value, 4) for name, value in components.items()},
            })

    links.sort(key=lambda item: (item["score"], item["image"].get("created_at") or ""), reverse=True)
    return links[:limit]


def compose_evidence_answer(query: str, items: list[dict]) -> dict:
    sources = items[:3]
    source_ids = [item["id"] for item in sources if item.get("id") is not None]
    terms = query_tokens(query)

    if not sources:
        return {"intent": "content", "text": "No indexed memories matched this question.", "source_ids": []}

    if terms.intersection({"where", "location", "place", "city"}):
        locations = list(dict.fromkeys(
            str(item["location"]).strip()
            for item in sources
            if item.get("location") and str(item["location"]).strip()
        ))
        text = (
            "The matching memories record these places: " + ", ".join(locations) + "."
            if locations
            else "I couldn't find explicit location metadata for these matching memories."
        )
        return {"intent": "location", "text": text, "source_ids": source_ids}

    if terms.intersection({"when", "date", "dated", "year", "month"}):
        dates = []
        for item in sources:
            value = _as_datetime(item.get("file_modified_at") or item.get("created_at"))
            if value:
                dates.append(value.date().isoformat())
        dates = list(dict.fromkeys(dates))
        text = (
            "The matching memories are dated " + ", ".join(dates) + "."
            if dates
            else "I couldn't find a stored date for these matching memories."
        )
        return {"intent": "time", "text": text, "source_ids": source_ids}

    best = sources[0]
    description = (best.get("visual_description") or "").strip()
    if not description:
        description = re.sub(r"\s+", " ", (best.get("ocr_text") or "").strip())[:220]
    text = f"The strongest match is {best.get('filename') or 'an indexed image'}."
    if description:
        text += f" Stored evidence: {description}"
    return {"intent": "content", "text": text, "source_ids": source_ids}