#!/usr/bin/env python3
"""
train.py

Fine-tunes DistilBERT for NER on the synthetic medical bill dataset.
Uses MPS (Apple Silicon) when available, falls back to CPU.

Output: ml/models/bill-ner/  (HuggingFace checkpoint)
"""

import os, sys
from pathlib import Path
import numpy as np
import torch
from datasets import load_from_disk
from transformers import (
    AutoTokenizer,
    AutoModelForTokenClassification,
    TrainingArguments,
    Trainer,
    DataCollatorForTokenClassification,
)
from seqeval.metrics import classification_report, f1_score

ML_DIR     = Path(__file__).parent.parent
DATA_DIR   = ML_DIR / "data" / "ner_dataset"
MODELS_DIR = ML_DIR / "models" / "bill-ner"

MODEL_NAME  = "distilbert-base-uncased"
LABEL_NAMES = ["O", "B-CHARGE", "B-ADJUST", "B-PIP", "B-HEALTH", "B-PATIENT", "B-OUTSTANDING"]
LABEL2ID    = {l: i for i, l in enumerate(LABEL_NAMES)}
ID2LABEL    = {i: l for i, l in enumerate(LABEL_NAMES)}

# ── Device ────────────────────────────────────────────────────────────────────

def get_device():
    # MPS has known OOM issues with HuggingFace Trainer on sequences >256 tokens.
    # CPU is stable and fast enough for short medical bill texts (mean 110 tokens).
    if torch.cuda.is_available():
        print("Using CUDA")
        return "cuda"
    print("Using CPU (MPS skipped — OOM on eval with variable-length sequences)")
    return "cpu"

# ── Metrics ───────────────────────────────────────────────────────────────────

def compute_metrics(eval_preds):
    logits, labels = eval_preds
    preds = np.argmax(logits, axis=-1)

    true_labels, true_preds = [], []
    for pred_row, label_row in zip(preds, labels):
        true_labels.append([ID2LABEL[l] for l in label_row if l != -100])
        true_preds.append([
            ID2LABEL[p] for p, l in zip(pred_row, label_row) if l != -100
        ])

    f1 = f1_score(true_labels, true_preds)
    return {"f1": f1}

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    device = get_device()

    print(f"Loading dataset from {DATA_DIR}...")
    dataset = load_from_disk(str(DATA_DIR))

    # Downsample train set: 8000 examples are sufficient for this task,
    # reduces CPU training time from ~4h to ~25 min with no meaningful quality loss.
    MAX_TRAIN = 8000
    if len(dataset["train"]) > MAX_TRAIN:
        dataset["train"] = dataset["train"].shuffle(seed=42).select(range(MAX_TRAIN))

    print(f"  train: {len(dataset['train'])}  val: {len(dataset['validation'])}  test: {len(dataset['test'])}")

    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForTokenClassification.from_pretrained(
        MODEL_NAME,
        num_labels=len(LABEL_NAMES),
        id2label=ID2LABEL,
        label2id=LABEL2ID,
        ignore_mismatched_sizes=True,
    )

    data_collator = DataCollatorForTokenClassification(tokenizer)

    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    training_args = TrainingArguments(
        output_dir=str(MODELS_DIR),
        num_train_epochs=5,
        per_device_train_batch_size=16,    # smaller batch → each step is faster on CPU
        per_device_eval_batch_size=32,
        learning_rate=3e-5,
        weight_decay=0.01,
        warmup_ratio=0.1,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        metric_for_best_model="f1",
        logging_steps=100,
        save_total_limit=2,
        fp16=False,
        dataloader_num_workers=0,
        report_to="none",
        no_cuda=True,          # force CPU — stable across Apple Silicon + Windows
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=dataset["train"],
        eval_dataset=dataset["validation"],
        tokenizer=tokenizer,
        data_collator=data_collator,
        compute_metrics=compute_metrics,
    )

    print("\nStarting training...")
    trainer.train()

    print("\nEvaluating on test set...")
    test_results = trainer.evaluate(dataset["test"])
    print(f"Test F1: {test_results.get('eval_f1', 0):.4f}")

    # Detailed per-class report on test set
    preds_output = trainer.predict(dataset["test"])
    preds = np.argmax(preds_output.predictions, axis=-1)
    labels = preds_output.label_ids

    true_labels, true_preds = [], []
    for pred_row, label_row in zip(preds, labels):
        true_labels.append([ID2LABEL[l] for l in label_row if l != -100])
        true_preds.append([
            ID2LABEL[p] for p, l in zip(pred_row, label_row) if l != -100
        ])

    print("\nPer-class report:")
    print(classification_report(true_labels, true_preds))

    # Save best model
    trainer.save_model(str(MODELS_DIR))
    tokenizer.save_pretrained(str(MODELS_DIR))
    print(f"\nModel saved to {MODELS_DIR}")

if __name__ == "__main__":
    main()
