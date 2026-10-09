import unittest

from src.models.crisis import _crisis_class_index


class CrisisClassIndexTests(unittest.TestCase):
    def test_uses_explicit_crisis_label(self):
        self.assertEqual(_crisis_class_index({0: "SAFE", 1: "CRISIS"}, 2), 1)
        self.assertEqual(_crisis_class_index({0: "CRISIS", 1: "SAFE"}, 2), 0)

    def test_uses_positive_class_for_generic_binary_labels(self):
        self.assertEqual(_crisis_class_index({0: "LABEL_0", 1: "LABEL_1"}, 2), 1)

    def test_rejects_ambiguous_non_binary_labels(self):
        with self.assertRaises(ValueError):
            _crisis_class_index({0: "LABEL_0", 1: "LABEL_1", 2: "LABEL_2"}, 3)


if __name__ == "__main__":
    unittest.main()
