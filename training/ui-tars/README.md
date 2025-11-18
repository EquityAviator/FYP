# UI-TARS 1.5 7B – Local Serving & Fine-Tuning

This directory contains everything needed to run the UI-TARS 1.5 7B model locally and fine-tune it on the dark-pattern dataset captured from the Chrome extension.

## Layout

- `datasets/` – raw + processed JSONL samples and referenced screenshots.
- `scripts/server.py` – FastAPI inference server that loads the checkpoint from `models/ui-tars-1.5-7b`.
- `scripts/build_dataset.py` – utility to validate/export dataset samples into the JSONL format expected by the trainer.
- `scripts/train_lora.py` – LoRA fine-tuning entry point (PyTorch + HuggingFace Transformers).
- `requirements.txt` – Python dependencies for serving + training.

## Quick Start

```bash
cd training/ui-tars
python -m venv .venv
. .venv/Scripts/activate  # or source .venv/bin/activate on macOS/Linux
pip install -r requirements.txt
```

1. **Download weights** into `models/ui-tars-1.5-7b/`.
2. **Export dataset** from the extension to `datasets/run-001/raw.jsonl` (see `build_dataset.py` for the schema).
3. **Process dataset**:
   ```bash
   python scripts/build_dataset.py \
     --input datasets/run-001/raw.jsonl \
     --image-root datasets/run-001/images \
     --output datasets/run-001/processed.jsonl
   ```
4. **Download model weights** (if hosted on HuggingFace):
   ```bash
   python scripts/download_model.py \
     --repo ui-tars/UI-TARS-1.5-7B \
     --target ../../models/ui-tars-1.5-7b
   ```
4. **Fine-tune**:
   ```bash
   python scripts/train_lora.py \
     --model-path ../../models/ui-tars-1.5-7b \
     --dataset datasets/run-001/processed.jsonl \
     --output-dir ../../models/ui-tars-1.5-7b-finetuned
   ```
5. **Serve** the fine-tuned model:
   ```bash
   uvicorn scripts.server:app --host 0.0.0.0 --port 8000
   ```

> The FastAPI server exposes `/infer` and `/health` endpoints that match the payload format expected by the Chrome extension. Update the extension’s `globalModelConfigManager` to point to `http://localhost:8000`.

