"""Fine-tune a ModernBERT / MentalBERT model for a mental-health classification task.

Usage example:
    python -m training.finetune \
        --model_id answerdotai/ModernBERT-large \
        --dataset_csv data/crisis_posts.csv \
        --text_column text \
        --label_column label \
        --output_dir ./outputs/crisis-classifier \
        --num_epochs 3

The script trains a sequence-classification head and exports the best checkpoint
as a Hugging Face model ready for use in the mental-health service catalog.
"""
import argparse
import json
import os
from pathlib import Path

import evaluate
import numpy as np
import torch
from datasets import Dataset, DatasetDict
from sklearn.model_selection import train_test_split
from transformers import (
    AutoModelForSequenceClassification,
    AutoTokenizer,
    EarlyStoppingCallback,
    Trainer,
    TrainingArguments,
)


def load_csv_dataset(path: str, text_column: str, label_column: str) -> DatasetDict:
    import pandas as pd

    df = pd.read_csv(path)
    df = df[[text_column, label_column]].dropna()
    df[label_column] = df[label_column].astype(str)

    # Map string labels to integers.
    unique_labels = sorted(df[label_column].unique().tolist())
    label2id = {label: i for i, label in enumerate(unique_labels)}
    id2label = {i: label for label, i in label2id.items()}
    df["labels"] = df[label_column].map(label2id)

    train_df, temp_df = train_test_split(df, test_size=0.3, random_state=42, stratify=df["labels"])
    val_df, test_df = train_test_split(temp_df, test_size=0.5, random_state=42, stratify=temp_df["labels"])

    return DatasetDict({
        "train": Dataset.from_pandas(train_df[[text_column, "labels"]].reset_index(drop=True)),
        "validation": Dataset.from_pandas(val_df[[text_column, "labels"]].reset_index(drop=True)),
        "test": Dataset.from_pandas(test_df[[text_column, "labels"]].reset_index(drop=True)),
    }), label2id, id2label


def main() -> None:
    parser = argparse.ArgumentParser(description="Fine-tune a mental-health classifier")
    parser.add_argument("--model_id", required=True, help="Base model on Hugging Face Hub")
    parser.add_argument("--dataset_csv", required=True, help="Path to CSV with text and label columns")
    parser.add_argument("--text_column", default="text")
    parser.add_argument("--label_column", default="label")
    parser.add_argument("--output_dir", default="./outputs/mental-health-classifier")
    parser.add_argument("--num_epochs", type=int, default=3)
    parser.add_argument("--batch_size", type=int, default=8)
    parser.add_argument("--learning_rate", type=float, default=2e-5)
    parser.add_argument("--max_length", type=int, default=512)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    dataset, label2id, id2label = load_csv_dataset(
        args.dataset_csv, args.text_column, args.label_column
    )

    tokenizer = AutoTokenizer.from_pretrained(args.model_id, trust_remote_code=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        args.model_id,
        num_labels=len(label2id),
        label2id=label2id,
        id2label=id2label,
        trust_remote_code=True,
    )

    def tokenize_function(examples: dict) -> dict:
        return tokenizer(
            examples[args.text_column],
            truncation=True,
            max_length=args.max_length,
            padding="max_length",
        )

    encoded_dataset = dataset.map(tokenize_function, batched=True)
    encoded_dataset = encoded_dataset.remove_columns([args.text_column])

    metric = evaluate.load("f1")

    def compute_metrics(eval_pred) -> dict:
        logits, labels = eval_pred
        predictions = np.argmax(logits, axis=-1)
        return metric.compute(predictions=predictions, references=labels, average="weighted")

    training_args = TrainingArguments(
        output_dir=str(output_dir / "checkpoints"),
        evaluation_strategy="epoch",
        save_strategy="epoch",
        learning_rate=args.learning_rate,
        per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size,
        num_train_epochs=args.num_epochs,
        weight_decay=0.01,
        load_best_model_at_end=True,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        seed=args.seed,
        report_to="none",
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=encoded_dataset["train"],
        eval_dataset=encoded_dataset["validation"],
        tokenizer=tokenizer,
        compute_metrics=compute_metrics,
        callbacks=[EarlyStoppingCallback(early_stopping_patience=2)],
    )

    trainer.train()

    # Save final model and label mapping.
    final_dir = output_dir / "model"
    trainer.save_model(str(final_dir))
    tokenizer.save_pretrained(str(final_dir))
    with open(final_dir / "label2id.json", "w", encoding="utf-8") as fh:
        json.dump(label2id, fh)
    with open(final_dir / "id2label.json", "w", encoding="utf-8") as fh:
        json.dump(id2label, fh)

    # Evaluate on test set.
    test_results = trainer.evaluate(encoded_dataset["test"])
    with open(output_dir / "test_results.json", "w", encoding="utf-8") as fh:
        json.dump(test_results, fh, indent=2)

    print(f"Model saved to {final_dir}")
    print(f"Test results: {test_results}")

    # Print catalog snippet.
    print("\nAdd this to config/models.yaml to use the trained model:")
    print(
        f"""
my_classifier:
  task: text-classification
  model_id: {final_dir.resolve()}
  threshold: 0.5
  enabled: true
""".strip()
    )


if __name__ == "__main__":
    main()
