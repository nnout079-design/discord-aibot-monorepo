import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src" / "models"))
from case_style import CaseStyleClassifier  # noqa: E402


class CaseStyleTests(unittest.IsolatedAsyncioTestCase):
    async def test_lowercase(self):
        result = await CaseStyleClassifier().predict("hello world")
        self.assertEqual(result["style"], "lowercase")
        self.assertEqual(result["letters"], 10)

    async def test_uppercase(self):
        result = await CaseStyleClassifier().predict("HELLO WORLD")
        self.assertEqual(result["style"], "uppercase")

    async def test_title_case(self):
        result = await CaseStyleClassifier().predict("Hello World")
        self.assertEqual(result["style"], "title-case")

    async def test_sponge_case(self):
        result = await CaseStyleClassifier().predict("hElLo WoRlD")
        self.assertEqual(result["style"], "sponge-case")

    async def test_mixed(self):
        result = await CaseStyleClassifier().predict("Hello WORLD")
        self.assertEqual(result["style"], "mixed")

    async def test_no_letters(self):
        result = await CaseStyleClassifier().predict("12345 !!!")
        self.assertEqual(result["style"], "none")


if __name__ == "__main__":
    unittest.main()
