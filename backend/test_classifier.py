import unittest

from classifier import classify_text, classify_text_detailed


class ClassifyTextTests(unittest.TestCase):
    def assertCategory(self, expected, filename, ocr_text, visual_description=""):
        category, confidence, _ = classify_text(filename, ocr_text, visual_description)
        self.assertEqual(expected, category)
        if expected != "Others":
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

    def test_generic_id_filename_is_not_enough_evidence(self):
        self.assertCategory("Others", "id.jpg", "")

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

    def test_generic_document_and_photo_words_are_not_category_evidence(self):
        for word in ("paper", "card", "document", "photo", "office", "person"):
            with self.subTest(word=word):
                category, confidence, _ = classify_text("image.jpg", word)
                self.assertEqual("Others", category)
                self.assertEqual(0.0, confidence)

    def test_low_ocr_confidence_does_not_dominate(self):
        result = classify_text_detailed("holiday.jpg", "prescription dosage hospital", ocr_confidence=0.05)
        self.assertIn(result["category"], {"Others", "Travel", "Medical & Health"})
        self.assertLess(result["confidence"], 0.8)

    def test_classification_records_margin_and_explainable_phrase_matches(self):
        result = classify_text_detailed("certificate.jpg", "Bachelor of Engineering University of Mumbai")
        self.assertEqual("Education", result["category"])
        self.assertGreater(result["score_margin"], 0)
        self.assertEqual("Education", result["candidates"][0]["category"])
        matches = result["evidence"]["Education"]["matches"]["ocr"]
        self.assertTrue(any(item["match"] == "bachelor of engineering" and item["strength"] == "strong" for item in matches))

    def test_ambiguous_evidence_requires_review(self):
        result = classify_text_detailed("document.jpg", "certificate passport")
        self.assertTrue(result["ambiguous"])
        self.assertEqual("needs_review", result["processing_status"])
        self.assertEqual("Others", result["category"])
        self.assertEqual(3, len(result["candidates"]))

    def test_labeled_real_world_examples(self):
        examples = [
            ("Government & Identity", "aadhaar.png", "Aadhaar card Unique Identification Authority"),
            ("Government & Identity", "pan.jpg", "Permanent Account Number PAN card income tax department"),
            ("Government & Identity", "passport.jpg", "Republic of India passport passport number nationality"),
            ("Government & Identity", "dl.jpg", "Driving licence transport department licence number"),
            ("Education", "engineering.jpg", "Bachelor of Engineering degree certificate University of Mumbai"),
            ("Education", "marks.jpg", "University marksheet semester grades examination"),
            ("Education", "notes.jpg", "College lecture notes engineering semester"),
            ("Medical & Health", "rx.jpg", "Prescription dosage medicine doctor pharmacy"),
            ("Medical & Health", "lab.jpg", "Medical report patient blood test diagnosis laboratory"),
            ("Finance", "bank.pdf.jpg", "Bank statement account number IFSC transaction balance"),
            ("Bills & Receipts", "invoice.jpg", "Tax invoice invoice number GST subtotal total amount due"),
            ("Bills & Receipts", "power.jpg", "Electricity bill consumer number amount due payment"),
            ("Bills & Receipts", "shop.jpg", "Shopping receipt item quantity subtotal total paid"),
            ("Work & Professional", "resume.jpg", "Resume work experience employment skills"),
            ("Work & Professional", "offer.jpg", "Offer letter employment contract designation salary"),
            ("Travel", "ticket.jpg", "Travel ticket flight airline departure arrival"),
            ("Travel", "boarding.jpg", "Boarding pass flight number departure gate airport"),
            ("Travel", "hotel.jpg", "Hotel booking check in check out reservation"),
            ("People & Family", "family.jpg", "", "A family photo of parents and children smiling"),
            ("Events & Celebrations", "birthday.jpg", "", "Birthday party with cake and balloons"),
            ("Animals & Pets", "dog.jpg", "", "A dog sitting on grass"),
            ("Animals & Pets", "cat.jpg", "", "A cat sleeping on a chair"),
            ("Nature & Places", "beach.jpg", "", "A beach photo with ocean waves and palm trees"),
            ("Nature & Places", "mountain.jpg", "", "Snowy mountain landscape"),
            ("Food & Drinks", "meal.jpg", "", "A plate of food with pasta and vegetables"),
            ("Screenshots", "screen.png", "", "A screenshot of a phone app showing a chat"),
            ("Notes & Documents", "handwritten.jpg", "", "Handwritten notes on a notebook page"),
            ("Others", "unknown.jpg", "", "An abstract blur of colored shapes"),
        ]
        for example in examples:
            expected, filename, ocr = example[:3]
            visual = example[3] if len(example) == 4 else ""
            with self.subTest(filename=filename):
                self.assertCategory(expected, filename, ocr, visual)

    def test_confusing_examples_use_combined_evidence(self):
        self.assertCategory("Education", "college_id.jpg", "College student ID card University of Delhi enrollment number")
        self.assertCategory("Bills & Receipts", "restaurant.jpg", "Restaurant receipt table subtotal GST total amount paid")
        self.assertCategory("Finance", "bank_screen.png", "Bank statement account balance transaction history", "A mobile screenshot of a banking app")
        self.assertCategory("Travel", "ticket_screen.png", "Boarding pass flight number gate departure", "A phone screenshot of an airline app")
        self.assertCategory("People & Family", "beach_day.jpg", "", "A family group photo on a beach with ocean in background")
        self.assertCategory("Education", "certificate.jpg", "Bachelor of Engineering certificate University of Mumbai", "A certificate document with a person's photo")


if __name__ == "__main__":
    unittest.main()
