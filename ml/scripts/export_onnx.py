#!/usr/bin/env python3
"""
export_onnx.py

Exports the fine-tuned DistilBERT NER model to ONNX format for
deployment in Node.js via onnxruntime-node on Windows CPU.

Output: ml/models/bill-ner.onnx  +  ml/models/tokenizer_config.json
"""

import json
from pathlib import Path
import torch
from transformers import AutoTokenizer, AutoModelForTokenClassification

ML_DIR     = Path(__file__).parent.parent
MODEL_DIR  = ML_DIR / "models" / "bill-ner"
ONNX_PATH  = ML_DIR / "models" / "bill-ner.onnx"
CONFIG_OUT = ML_DIR / "models" / "ner_config.json"

LABEL_NAMES = ["O", "B-CHARGE", "B-ADJUST", "B-PIP", "B-HEALTH", "B-PATIENT", "B-OUTSTANDING"]

def main():
    if not MODEL_DIR.exists():
        print(f"ERROR: Model not found at {MODEL_DIR}")
        print("Run train.py first.")
        return

    print(f"Loading model from {MODEL_DIR}...")
    tokenizer = AutoTokenizer.from_pretrained(str(MODEL_DIR))
    model = AutoModelForTokenClassification.from_pretrained(str(MODEL_DIR))
    model.eval()

    # Dummy input for tracing
    dummy_text = "Total Charges: $1,250.00 Insurance Paid: -$900.00 Balance Due: $350.00"
    inputs = tokenizer(dummy_text, return_tensors="pt", truncation=True, max_length=512)

    print("Exporting to ONNX...")
    torch.onnx.export(
        model,
        (inputs["input_ids"], inputs["attention_mask"]),
        str(ONNX_PATH),
        input_names=["input_ids", "attention_mask"],
        output_names=["logits"],
        dynamic_axes={
            "input_ids":      {0: "batch", 1: "seq_len"},
            "attention_mask": {0: "batch", 1: "seq_len"},
            "logits":         {0: "batch", 1: "seq_len"},
        },
        opset_version=14,
        do_constant_folding=True,
    )
    print(f"ONNX model saved: {ONNX_PATH}")

    # Save tokenizer vocab and config for Node.js use
    tokenizer.save_pretrained(str(ML_DIR / "models" / "tokenizer"))

    # Save compact inference config
    config = {
        "model_path": "bill-ner.onnx",
        "tokenizer_path": "tokenizer",
        "labels": LABEL_NAMES,
        "max_length": 512,
    }
    CONFIG_OUT.write_text(json.dumps(config, indent=2))
    print(f"Config saved: {CONFIG_OUT}")

    # Report file size
    size_mb = ONNX_PATH.stat().st_size / 1024 / 1024
    print(f"\nONNX model size: {size_mb:.1f} MB")

    # Quick sanity check with onnxruntime
    try:
        import onnxruntime as ort
        import numpy as np
        sess = ort.InferenceSession(str(ONNX_PATH))
        result = sess.run(
            ["logits"],
            {
                "input_ids":      inputs["input_ids"].numpy(),
                "attention_mask": inputs["attention_mask"].numpy(),
            }
        )
        preds = np.argmax(result[0], axis=-1)[0]
        tokens = tokenizer.convert_ids_to_tokens(inputs["input_ids"][0])
        print("\nSanity check — predicted labels on test sentence:")
        for tok, pred in zip(tokens, preds):
            label = LABEL_NAMES[pred]
            if label != "O":
                print(f"  {tok:20} → {label}")
        print("Export successful.")
    except Exception as e:
        print(f"onnxruntime check failed: {e}")
        print("Export completed but runtime validation skipped.")

if __name__ == "__main__":
    main()
