"""Evaluate a trained mental-health classifier on a held-out CSV.

Usage:
    python -m training.evaluate \
        --model_path ./outputs/crisis-classifier/model \
        --dataset_csv data/crisis_posts_test.csv \
        --text_column text \
        --label_column label
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from sklearn.metrics import classification_report
from transformers import AutoModelForSequenceClassification, AutoTokenizer


def evaluate_model(model_path: str, dataset_csv: str, text_column: str, label_column: str) -> None:
    df = pd.read_csv(dataset_csv)
    df = df[[text_column, label_column]].dropna()

    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    model = AutoModelForSequenceClassification.from_pretrained(model_path, trust_remote_code=True)
    model.eval()

    id2label = model.config.id2label
    texts = df[text_column].tolist()
    true_labels = df[label_column].astype(str).tolist()

    inputs = tokenizer(
        texts,
        return_tensors="pt",
        padding=True,
        truncation=True,
        max_length=512,
    )
    if "token_type_ids" in inputs:
        del inputs["token_type_ids"]

    with torch.no_grad():
        outputs = model(**inputs)
    preds = torch.argmax(outputs.logits, dim=-1).cpu().numpy()
    pred_labels = [id2label[p] for p in preds]

    print(classification_report(true_labels, pred_labels, zero_division=0))

    report_path = Path(model_path) / "evaluation_report.txt"
    with open(report_path, "w", encoding="utf-8") as fh:
        fh.write(classification_report(true_labels, pred_labels, zero_division=0))
    print(f"Report written to {report_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a trained classifier")
    parser.add_argument("--model_path", required=True)
    parser.add_argument("--dataset_csv", required=True)
    parser.add_argument("--text_column", default="text")
    parser.add_argument("--label_column", default="label")
    args = parser.parse_args()

    evaluate_model(args.model_path, args.dataset_csv, args.text_column, args.label_column)


if __name__ == "__main__":
    main()
