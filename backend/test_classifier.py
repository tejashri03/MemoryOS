import unittest

from classifier import classify_text


class ClassifyTextTests(unittest.TestCase):
    def assertCategory(self, expected, filename, ocr_text, visual_description=""):
        category, confidence, _ = classify_text(filename, ocr_text, visual_description)
        self.assertEqual(expected, category)
        self.assertGreater(confidence, 0.0)

    def test_travel_document_beats_passport_identity_signal(self):
        self.assertCategory(
            "Travel",
            "passport_beach.jpg",
            "boarding pass passport airport flight departure arrival",
        )

    def test_medical_report_is_not_a_generic_document(self):
        self.assertCategory(
            "Medical & Health",
            "scan.png",
            "patient diagnosis blood pressure prescription dosage hospital",
        )

    def test_restaurant_receipt_is_a_bill(self):
        self.assertCategory(
            "Bills & Receipts",
            "restaurant_receipt.jpg",
            "restaurant receipt subtotal total amount due payment",
        )

    def test_receipt_with_generic_certificate_word_is_still_a_bill(self):
        self.assertCategory(
            "Bills & Receipts",
            "receipt.jpg",
            "certificate receipt total amount due payment",
        )

    def test_school_fee_receipt_is_not_education(self):
        self.assertCategory(
            "Bills & Receipts",
            "school_fee_receipt.jpg",
            "school student fee receipt total amount paid",
        )

    def test_bank_statement_is_finance(self):
        self.assertCategory(
            "Finance",
            "statement.jpg",
            "bank statement account number transaction balance",
        )

    def test_id_card_is_government_identity(self):
        self.assertCategory(
            "Government & Identity",
            "id_card.jpg",
            "id card name date of birth address",
        )

    def test_id_filename_is_government_identity(self):
        self.assertCategory("Government & Identity", "id.jpg", "")

    def test_identity_proof_is_government_identity(self):
        self.assertCategory(
            "Government & Identity",
            "official.jpg",
            "identity proof document",
        )

    def test_income_certificate_is_finance(self):
        self.assertCategory(
            "Finance",
            "income_certificate.jpg",
            "income certificate issued by government annual income",
        )

    def test_income_cert_abbreviation_is_finance(self):
        self.assertCategory("Finance", "income_cert.jpg", "income cert")

    def test_academic_certificate_remains_education(self):
        self.assertCategory(
            "Education",
            "degree_certificate.jpg",
            "degree certificate university semester grade marks",
        )

    def test_screenshot_has_strong_structural_evidence(self):
        self.assertCategory(
            "Screenshots",
            "screen.png",
            "browser screenshot whatsapp chat notification url",
        )

    def test_visual_caption_can_classify_non_document_photo(self):
        self.assertCategory(
            "Animals & Pets",
            "IMG_1001.jpg",
            "",
            "a small puppy sitting next to a dog",
        )

    def test_weak_evidence_is_not_presented_as_certain(self):
        category, confidence, _ = classify_text("photo.jpg", "a photo")
        self.assertEqual("Others", category)
        self.assertEqual(0.0, confidence)


if __name__ == "__main__":
    unittest.main()
