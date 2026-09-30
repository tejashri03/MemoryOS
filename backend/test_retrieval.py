import unittest

from retrieval import adaptive_weights, compose_evidence_answer, contextual_links, evidence_adaptive_weights, find_duplicate_groups, is_relevant_candidate, score_candidate


class AdaptiveRetrievalTests(unittest.TestCase):
    def test_weights_shift_toward_ocr_for_document_queries(self):
        document = adaptive_weights("invoice number 4921")
        visual = adaptive_weights("dog photos in a garden")

        self.assertGreater(document["ocr"], visual["ocr"])
        self.assertGreater(visual["semantic"], document["semantic"])
        self.assertAlmostEqual(1.0, sum(document.values()))
        self.assertAlmostEqual(1.0, sum(visual.values()))

    def test_similarity_evidence_increases_the_weight_of_its_channel(self):
        base = adaptive_weights("memories")
        evidence = [{"semantic": 0.9, "ocr": 0.0, "caption": 0.0, "keywords": 0.0, "metadata": 0.0, "full_text": 0.0}] * 5

        adjusted = evidence_adaptive_weights("memories", evidence)

        self.assertGreater(adjusted["semantic"], base["semantic"])
        self.assertAlmostEqual(1.0, sum(adjusted.values()))

    def test_missing_semantic_model_redistributes_weights(self):
        weights = adaptive_weights("dog photos", semantic_available=False)

        self.assertEqual(0.0, weights["semantic"])
        self.assertAlmostEqual(1.0, sum(weights.values()))

    def test_semantic_only_candidate_can_score_without_lexical_matches(self):
        result = score_candidate(
            "dog photos",
            {"filename": "IMG_007.jpg"},
            semantic_similarity=0.82,
            text_score=0,
            semantic_available=True,
        )

        self.assertGreater(result["score"], 0.0)
        self.assertEqual(0.82, result["signals"]["semantic"])

    def test_ocr_confidence_scales_ocr_evidence(self):
        item = {"ocr_text": "invoice number 4921", "ocr_confidence": 0.25}
        result = score_candidate("invoice number 4921", item, 0.0, 0.0, False)

        self.assertAlmostEqual(0.25, result["signals"]["ocr"])

    def test_classifier_keyword_evidence_contributes_to_search_score(self):
        item = {
            "classification_evidence": {
                "Animals & Pets": {
                    "matches": {"visual": [{"match": "dog", "strength": "strong"}]}
                }
            }
        }

        result = score_candidate("dog", item, 0.0, 0.0, False)

        self.assertEqual(1.0, result["signals"]["classifier_keywords"])
        self.assertGreater(result["score"], 0.0)

    def test_natural_language_search_instructions_do_not_dilute_keywords(self):
        item = {"keywords": "dog, pet", "category": "Animals & Pets"}

        natural_language = score_candidate("Please find my dog", item, 0.0, 0.0, False)
        keywords_only = score_candidate("dog", item, 0.0, 0.0, False)

        self.assertEqual(
            keywords_only["signals"]["keywords"],
            natural_language["signals"]["keywords"],
        )

    def test_relevance_gate_rejects_weak_only_candidates(self):
        signals = {"semantic": 0.2, "keywords": 0.25, "ocr": 0.0}

        self.assertFalse(is_relevant_candidate(signals, 0.11))
        self.assertFalse(is_relevant_candidate({"keywords": 1.0}, 0.09))

    def test_relevance_gate_keeps_keyword_and_strong_semantic_matches(self):
        self.assertTrue(is_relevant_candidate({"keywords": 0.5}, 0.12))
        self.assertTrue(is_relevant_candidate({"semantic": 0.65}, 0.14))

    def test_duplicate_groups_use_exact_hashes(self):
        images = [
            {"id": 1, "file_hash": "same", "phash": "0" * 16},
            {"id": 2, "file_hash": "same", "phash": "f" * 16},
        ]

        groups = find_duplicate_groups(images)

        self.assertEqual("exact_duplicate", groups[0]["type"])

    def test_duplicate_groups_use_perceptual_hash_fallback(self):
        images = [
            {"id": 1, "file_hash": "one", "phash": "0" * 16},
            {"id": 2, "file_hash": "two", "phash": "0" * 15 + "1"},
        ]

        groups = find_duplicate_groups(images)

        self.assertEqual("near_duplicate", groups[0]["type"])
        self.assertEqual(98, groups[0]["similarity"])

    def test_duplicate_groups_use_clip_threshold_without_hash_match(self):
        images = [
            {"id": 1, "file_hash": "one", "phash": "0" * 16, "image_embedding": [1.0, 0.0]},
            {"id": 2, "file_hash": "two", "phash": "f" * 16, "image_embedding": [0.9, 0.435889894]},
        ]

        groups = find_duplicate_groups(images)

        self.assertEqual("near_duplicate", groups[0]["type"])
        self.assertGreaterEqual(groups[0]["similarity"], 85)

    def test_unrelated_hashes_and_embeddings_are_not_duplicates(self):
        images = [
            {"id": 1, "file_hash": "one", "phash": "0" * 16, "image_embedding": [1.0, 0.0]},
            {"id": 2, "file_hash": "two", "phash": "f" * 16, "image_embedding": [0.8, 0.6]},
        ]

        self.assertEqual([], find_duplicate_groups(images))

    def test_context_links_explain_shared_time_place_and_category(self):
        target = {
            "id": 1,
            "created_at": "2026-06-02T12:00:00",
            "location": "Goa, India",
            "category": "Travel",
            "visual_description": "A beach at sunset",
        }
        candidate = {
            "id": 2,
            "created_at": "2026-06-04T12:00:00",
            "location": "Goa, India",
            "category": "Travel",
            "visual_description": "Sunset over a beach",
        }

        links = contextual_links(target, [target, candidate])

        self.assertEqual(2, links[0]["image"]["id"])
        self.assertIn("Same place", links[0]["reasons"])
        self.assertIn("Same category", links[0]["reasons"])
        self.assertIn("Same week", links[0]["reasons"])

    def test_context_link_omits_weak_unrelated_memories(self):
        target = {"id": 1, "created_at": "2026-01-01", "category": "Travel"}
        unrelated = {"id": 2, "created_at": "2024-01-01", "category": "Finance"}

        self.assertEqual([], contextual_links(target, [unrelated]))

    def test_evidence_answer_returns_source_ids_and_stored_location(self):
        answer = compose_evidence_answer(
            "Where did we travel?",
            [{"id": 17, "filename": "goa.jpg", "location": "Goa, India"}],
        )

        self.assertEqual("location", answer["intent"])
        self.assertIn("Goa, India", answer["text"])
        self.assertEqual([17], answer["source_ids"])

    def test_evidence_answer_does_not_invent_missing_location(self):
        answer = compose_evidence_answer(
            "Where was this?",
            [{"id": 18, "filename": "trip.jpg", "location": None}],
        )

        self.assertIn("couldn't find explicit location metadata", answer["text"])
        self.assertEqual([18], answer["source_ids"])


if __name__ == "__main__":
    unittest.main()