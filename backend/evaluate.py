"""Evaluate manually labeled classification and search fixtures.

The JSONL dataset is intentionally plain text so new labeled examples can be added without code changes.
No accuracy value is produced when the dataset has no examples.
"""

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from classifier import classify_text


def load_records(path):
    with Path(path).open(encoding="utf-8") as source:
        return [json.loads(line) for line in source if line.strip() and not line.lstrip().startswith("#")]


def classification_metrics(records):
    records = [record for record in records if record.get("expected_category")]
    if not records:
        return {"count": 0}
    labels = sorted({record["expected_category"] for record in records})
    matrix = {label: {candidate: 0 for candidate in labels} for label in labels}
    top1 = top3 = 0
    for record in records:
        category, _, scores = classify_text(record.get("filename", record.get("image_path", "")), record.get("ocr_text", ""), record.get("visual_description", ""), record.get("ocr_confidence", 1.0))
        ranked = [name for name, _ in sorted(scores.items(), key=lambda item: item[1], reverse=True)]
        expected = record["expected_category"]
        predicted = category if category in labels else "Others"
        matrix.setdefault(expected, {candidate: 0 for candidate in labels})
        matrix[expected].setdefault(predicted, 0)
        matrix[expected][predicted] += 1
        top1 += int(predicted == expected)
        top3 += int(expected in ranked[:3])
    per_label = {}
    for label in labels:
        true_positive = matrix[label].get(label, 0)
        false_positive = sum(matrix[other].get(label, 0) for other in labels if other != label)
        false_negative = sum(value for candidate, value in matrix[label].items() if candidate != label)
        precision = true_positive / (true_positive + false_positive) if true_positive + false_positive else 0.0
        recall = true_positive / (true_positive + false_negative) if true_positive + false_negative else 0.0
        per_label[label] = {"precision": round(precision, 4), "recall": round(recall, 4), "f1": round(2 * precision * recall / (precision + recall), 4) if precision + recall else 0.0}
    macro_f1 = sum(item["f1"] for item in per_label.values()) / len(per_label)
    return {"count": len(records), "accuracy": round(top1 / len(records), 4), "top_1": round(top1 / len(records), 4), "top_3": round(top3 / len(records), 4), "per_category": per_label, "confusion_matrix": matrix, "macro_f1": round(macro_f1, 4)}


def search_metrics(records):
    records = [record for record in records if record.get("expected_ids") and record.get("retrieved_ids") is not None]
    if not records:
        return {"count": 0}
    metrics = {}
    for k in (1, 3, 5, 10):
        precision = recall = 0.0
        for record in records:
            expected = set(record["expected_ids"])
            retrieved = record["retrieved_ids"][:k]
            hits = len(expected.intersection(retrieved))
            precision += hits / k
            recall += hits / len(expected) if expected else 0.0
        metrics[f"precision_at_{k}"] = round(precision / len(records), 4)
        metrics[f"recall_at_{k}"] = round(recall / len(records), 4)
    reciprocal_rank = 0.0
    for record in records:
        expected = set(record["expected_ids"])
        reciprocal_rank += next((1 / (index + 1) for index, item in enumerate(record["retrieved_ids"]) if item in expected), 0.0)
    metrics["mrr"] = round(reciprocal_rank / len(records), 4)
    return {"count": len(records), **metrics}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", nargs="?", default="evaluation/dataset.jsonl")
    args = parser.parse_args()
    records = load_records(args.dataset)
    print(json.dumps({"classification": classification_metrics(records), "search": search_metrics(records)}, indent=2))


if __name__ == "__main__":
    main()