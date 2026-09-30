import unittest

import numpy as np

from embedding_service import (
    CLASSIFICATION_CATEGORIES,
    CLASSIFICATION_PROMPTS,
    CLASSIFICATION_PROMPTS_PER_CATEGORY,
    _classification_prompt_variants,
    _combine_classification_prompts,
)


class ClassificationPromptTests(unittest.TestCase):
    def test_each_category_has_three_prompt_variants(self):
        prompts = _classification_prompt_variants()

        self.assertEqual(
            len(CLASSIFICATION_CATEGORIES) * CLASSIFICATION_PROMPTS_PER_CATEGORY,
            len(prompts),
        )
        self.assertEqual(CLASSIFICATION_PROMPTS[0], prompts[0])
        self.assertIn("The image shows", prompts[1])
        self.assertIn("This is an example of", prompts[2])

    def test_prompt_embeddings_are_averaged_and_renormalized_per_category(self):
        vectors = np.array(
            [[2.0, 0.0], [1.0, 0.0], [0.0, 3.0], [0.0, 1.0]],
            dtype=np.float32,
        )

        combined = _combine_classification_prompts(vectors, 2, 2)

        np.testing.assert_allclose(combined, [[1.0, 0.0], [0.0, 1.0]])

    def test_invalid_prompt_embedding_count_is_rejected(self):
        with self.assertRaises(ValueError):
            _combine_classification_prompts(np.ones((3, 2)), 2, 2)


if __name__ == "__main__":
    unittest.main()
