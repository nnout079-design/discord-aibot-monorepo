"""Export a PyTorch transformer classifier to ONNX for faster CPU inference.

Usage:
    python -m training.export_onnx \
        --model_path ./outputs/crisis-classifier/model \
        --output_path ./outputs/crisis-classifier/model.onnx
"""
import argparse
from pathlib import Path

import torch
from transformers import AutoModelForSequenceClassification, AutoTokenizer


def export_classifier(model_path: str, output_path: str, max_length: int = 512) -> None:
    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    model = AutoModelForSequenceClassification.from_pretrained(
        model_path,
        trust_remote_code=True,
    )
    model.eval()

    dummy_text = "This is a sample mental-health screening input."
    inputs = tokenizer(dummy_text, return_tensors="pt", max_length=max_length, padding="max_length", truncation=True)
    if "token_type_ids" in inputs:
        del inputs["token_type_ids"]

    input_names = list(inputs.keys())
    dynamic_axes = {name: {0: "batch_size", 1: "sequence_length"} for name in input_names}
    dynamic_axes["logits"] = {0: "batch_size"}

    torch.onnx.export(
        model,
        tuple(inputs.values()),
        output,
        input_names=input_names,
        output_names=["logits"],
        dynamic_axes=dynamic_axes,
        opset_version=14,
        do_constant_folding=True,
    )

    print(f"ONNX model exported to {output}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Export a classifier to ONNX")
    parser.add_argument("--model_path", required=True)
    parser.add_argument("--output_path", required=True)
    parser.add_argument("--max_length", type=int, default=512)
    args = parser.parse_args()

    export_classifier(args.model_path, args.output_path, args.max_length)


if __name__ == "__main__":
    main()
