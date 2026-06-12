# RenamerJF · Medical Document Manager

A desktop application (Electron + React) for managing and renaming medical records in personal injury law firms. Automates provider identification, date extraction, and billing field extraction from PDF documents — with a DistilBERT NER model as the local ML layer before falling back to Gemini AI.

---

## Features

- **Automatic provider identification** — fuzzy + exact matching against a local provider database (Fuse.js)
- **Billing field extraction** — cascading parser pipeline: Athena Health regex → summary table → CPT line items → hospital totals → ML-NER → Gemini AI
- **DistilBERT NER model** — fine-tuned for medical billing token classification (F1 = 0.965), runs locally via ONNX Runtime with no Python dependency at inference time
- **OCR fallback** — Tesseract.js handles scanned PDFs and image documents
- **Batch renaming** — process multiple files at once with a consistent naming convention
- **Case tracker** — manage case metadata and link documents to cases
- **AI chat** — ask questions about any loaded document via Gemini

---

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Electron 33 |
| Frontend | React 18 + Vite (inline styles) |
| Backend | Node.js + Express 5 |
| Database | SQLite via better-sqlite3 |
| ML inference | ONNX Runtime (`onnxruntime-node`) |
| ML training | Python · HuggingFace Transformers · DistilBERT |
| OCR | Tesseract.js |
| AI fallback | Google Gemini API |
| Provider matching | Fuse.js |

---

## ML Model — DistilBERT NER

A `distilbert-base-uncased` model fine-tuned for Named Entity Recognition on synthetic medical billing data generated with [Synthea](https://github.com/synthetichealth/synthea).

**Labels (7):** `O` · `B-CHARGE` · `B-ADJUST` · `B-PIP` · `B-HEALTH` · `B-PATIENT` · `B-OUTSTANDING`

The trained model is exported to ONNX and loaded at runtime via `onnxruntime-node`. A custom JavaScript WordPiece tokenizer reads `vocab.txt` directly — no Python or HuggingFace runtime required in production.

> **Privacy policy:** Real patient records are never used for training or fed to LLMs. Only synthetic data is used.

To retrain the model:

```bash
cd ml/
python -m venv .venv && source .venv/bin/activate
pip install transformers datasets torch
python scripts/prepare_dataset.py
python scripts/train.py
python scripts/export_onnx.py   # outputs models/bill-ner.onnx
The model weights (models/bill-ner/, models/bill-ner.onnx) are excluded from this repository via .gitignore due to file size (~253 MB). Retrain locally using the scripts above.

Billing Parser — Confidence Cascade
PDF text
  └─ Athena Health regex        (high confidence)
  └─ Summary table regex
  └─ CPT line items
  └─ Hospital totals regex
  └─ ML-NER (DistilBERT ONNX)  ← activates if confidence < 70%
  └─ Gemini AI                 ← activates if confidence < 35% + user consent
Setup
Prerequisites
Node.js ≥ 18
Python ≥ 3.10 (only needed for ML training, not runtime)
Development
# Install dependencies
npm install

# Copy the environment template and fill in your keys
cp .env.example .env

# Start (Electron + backend + frontend hot reload)
npm run dev
Environment Variables (.env)
GEMINI_API_KEY=your_key_here
JWT_SECRET=your_secret_here
SEED_ADMIN_NAME=Admin
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=changeme
Build
npm run build:mac   # .dmg for macOS (arm64 + x64)
npm run build:win   # .exe installer for Windows x64
Project Structure
├── electron/          Desktop shell (main process + preload)
├── frontend/          React app (Vite)
│   └── src/
│       ├── components/   BillingCalculator, BillingPanel, FileRenamer, ...
│       └── pages/        Dashboard, Login
├── backend/           Express API
│   └── src/
│       ├── routes/       analyze, billing, auth, cases, chat, ...
│       └── services/     billingParser, docAnalyzer, billingAI, ocr, ...
└── ml/                ML training pipeline
    ├── scripts/          train.py, export_onnx.py, prepare_dataset.py
    └── models/           infer.js, ner_config.json, tokenizer/
License
Private — all rights reserved.
