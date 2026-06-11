#!/usr/bin/env python3
"""
prepare_dataset.py

Reads the rendered PDF bills + JSON labels and builds a NER training dataset
for DistilBERT token classification.

Each example:
  input:  raw text extracted from a synthetic bill PDF
  output: per-token labels (O, B-CHARGE, B-ADJUST, B-PIP, B-HEALTH, B-PATIENT, B-OUTSTANDING)

Saves a HuggingFace Dataset to ml/data/ner_dataset/
"""

import os, json, re, sys
from pathlib import Path
from pdfminer.high_level import extract_text
from datasets import Dataset, DatasetDict, ClassLabel, Sequence, Features, Value
from transformers import AutoTokenizer

ML_DIR     = Path(__file__).parent.parent
BILLS_DIR  = ML_DIR / "data" / "rendered-bills"
LABELS_DIR = ML_DIR / "data" / "labels"
OUT_DIR    = ML_DIR / "data" / "ner_dataset"

MODEL_NAME  = "distilbert-base-uncased"
MAX_LENGTH  = 256      # covers 98.2% of bill texts; avoids slow 512-token batches on CPU

LABEL_NAMES = ["O", "B-CHARGE", "B-ADJUST", "B-PIP", "B-HEALTH", "B-PATIENT", "B-OUTSTANDING"]
LABEL2ID    = {l: i for i, l in enumerate(LABEL_NAMES)}
ID2LABEL    = {i: l for i, l in enumerate(LABEL_NAMES)}

# ── Money formatting ──────────────────────────────────────────────────────────

def fmt_money(val):
    """Return the money string as it appears in the rendered PDF."""
    if val == 0:
        return "$0.00"
    s = f"${abs(val):,.2f}"
    return s

def money_variants(val):
    """All text forms a value might take (positive and negative)."""
    if val == 0:
        return {"$0.00"}
    s = fmt_money(val)
    return {s, f"-{s}"}

# ── Contextual search: find the right occurrence of a value ──────────────────

_ANCHORS = {
    "B-CHARGE": [
        r"TOTAL\s+CHARGE\s+OUTSTANDING",
        r"Total\s+Gross\s+Charges?",
        r"Total\s+Charges?",
        r"Service\s+Charges",
    ],
    "B-ADJUST": [
        r"CONTRACTUAL",
        r"Contractual\s+Adj",
        r"Contractual\s+Adjustment",
    ],
    "B-PIP": [
        r"PIP",
        r"Personal\s+Injury",
        r"PIP\s+Auto\s+Insurance",
    ],
    "B-HEALTH": [
        r"Insurance\s+Paid",
        r"PAYMENT\s+\w",         # Athena-raw payment line (non-patient)
        r"Blue\s+Cross",
        r"Medicaid",
        r"Medicare",
        r"Aetna",
        r"Cigna",
        r"Humana",
        r"Anthem",
        r"UnitedHealthcare",
        r"Dual\s+Eligible",
    ],
    "B-PATIENT": [
        r"PAYMENT\s+PATIENT",
        r"Patient\s+Payment",
        r"Patient\s+Paid",
        r"Patient\s+Cash",
    ],
    "B-OUTSTANDING": [
        r"OUTSTANDING\s+\$",
        r"OUTSTANDING$",
        r"Balance\s+Due",
        r"Patient\s+Balance\s+Due",
        r"Current\s+Balance\s+Due",
    ],
}

def find_span(text, label, value):
    """
    Find the character span of `value` in `text` for `label`.
    Uses anchors to disambiguate when the same amount appears multiple times.
    Returns (start, end) or None.
    """
    if value == 0:
        return None     # Skip zero amounts — too ambiguous

    variants = money_variants(value)
    anchors  = _ANCHORS.get(label, [])

    # 1. Try anchor-contextual match (within 120 chars of an anchor)
    for anchor_pat in anchors:
        for m_anchor in re.finditer(anchor_pat, text, re.IGNORECASE):
            window_start = max(0, m_anchor.start() - 20)
            window_end   = min(len(text), m_anchor.end() + 120)
            window       = text[window_start:window_end]
            for variant in variants:
                idx = window.find(variant)
                if idx != -1:
                    abs_start = window_start + idx
                    return (abs_start, abs_start + len(variant))

    # 2. Fall back: last occurrence of the value in the text (totals at end)
    best = None
    for variant in variants:
        start = 0
        while True:
            idx = text.find(variant, start)
            if idx == -1:
                break
            best = (idx, idx + len(variant))
            start = idx + 1
    return best

# ── Build per-token labels from character spans ───────────────────────────────

def char_spans_to_token_labels(text, spans, tokenizer):
    """
    Given character-level spans {label: (start, end)}, tokenize text and assign
    per-token labels.  Sub-word tokens beyond the first get label -100 (ignored).
    """
    encoding = tokenizer(
        text,
        truncation=True,
        max_length=MAX_LENGTH,
        return_offsets_mapping=True,
    )
    offset_mapping = encoding["offset_mapping"]
    labels = []

    # Build a char→label map
    char_label = {}
    for label, (cs, ce) in spans.items():
        for c in range(cs, ce):
            char_label[c] = label

    prev_word_id = None
    for i, (tok_start, tok_end) in enumerate(offset_mapping):
        if tok_start == tok_end:      # [CLS], [SEP], padding
            labels.append(-100)
            continue

        token_label = LABEL2ID["O"]
        for c in range(tok_start, tok_end):
            if c in char_label:
                token_label = LABEL2ID[char_label[c]]
                break

        # Only the first sub-word gets the real label; rest get -100
        word_id = encoding.word_ids()[i]
        if word_id is not None and word_id == prev_word_id:
            labels.append(-100)
        else:
            labels.append(token_label)
            prev_word_id = word_id

    return {
        "input_ids":      encoding["input_ids"],
        "attention_mask": encoding["attention_mask"],
        "labels":         labels,
    }

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

    label_files = sorted(LABELS_DIR.glob("*.json"))
    print(f"Found {len(label_files)} labeled bills — extracting text and building NER examples...")

    examples = []
    skipped  = 0

    for i, lf in enumerate(label_files):
        label  = json.loads(lf.read_text())
        pdf_path = BILLS_DIR / label["filename"]

        if not pdf_path.exists():
            skipped += 1
            continue

        try:
            text = extract_text(str(pdf_path))
        except Exception:
            skipped += 1
            continue

        if not text or len(text.strip()) < 20:
            skipped += 1
            continue

        # Map each non-zero financial field to its label
        field_map = {
            "B-CHARGE":      label["totalCharge"],
            "B-ADJUST":      label["adjustments"],
            "B-PIP":         label["pipPaid"],
            "B-HEALTH":      label["healthPaid"],
            "B-PATIENT":     label["patientPaid"],
            "B-OUTSTANDING": label["outstanding"],
        }

        spans = {}
        for ner_label, value in field_map.items():
            if value > 0:
                span = find_span(text, ner_label, value)
                if span:
                    spans[ner_label] = span

        # Require at least 2 labeled fields to be useful
        if len(spans) < 2:
            skipped += 1
            continue

        enc = char_spans_to_token_labels(text, spans, tokenizer)
        enc["format"] = label["format"]
        examples.append(enc)

        if (i + 1) % 500 == 0:
            print(f"  {i+1}/{len(label_files)} processed, {len(examples)} kept, {skipped} skipped")

    print(f"\nTotal examples: {len(examples)}  (skipped: {skipped})")

    # Label distribution
    from collections import Counter
    counts = Counter()
    for ex in examples:
        for l in ex["labels"]:
            if l >= 0:
                counts[ID2LABEL.get(l, "O")] += 1
    print("\nLabel distribution:")
    for name, count in sorted(counts.items()):
        print(f"  {name:20}: {count:,}")

    # Shuffle and split 80/10/10
    import random
    random.seed(42)
    random.shuffle(examples)
    n = len(examples)
    n_train = int(n * 0.80)
    n_val   = int(n * 0.10)

    splits = {
        "train": examples[:n_train],
        "validation": examples[n_train:n_train + n_val],
        "test": examples[n_train + n_val:],
    }

    print(f"\nSplit sizes — train: {len(splits['train'])}  val: {len(splits['validation'])}  test: {len(splits['test'])}")

    # Save as HuggingFace Dataset
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    dataset_dict = {}
    for split_name, split_data in splits.items():
        dataset_dict[split_name] = Dataset.from_list(split_data)

    DatasetDict(dataset_dict).save_to_disk(str(OUT_DIR))
    print(f"\nDataset saved to {OUT_DIR}")

if __name__ == "__main__":
    main()
