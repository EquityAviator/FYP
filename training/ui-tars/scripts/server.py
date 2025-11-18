"""
FastAPI server for the UI-TARS 1.5 7B model.

Run with:
    uvicorn scripts.server:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Optional

import torch
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from transformers import AutoModelForCausalLM, AutoTokenizer

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL_PATH = REPO_ROOT / "models" / "ui-tars-1.5-7b"


class InferRequest(BaseModel):
    instruction: str = Field(..., description="Main user request / task.")
    dom_snapshot: Optional[str] = Field(
        None,
        description="Optional DOM or HTML snippet to give the model more context.",
    )
    evidence: Optional[list[str]] = Field(
        default=None,
        description="Additional text snippets such as OCR output or previous detections.",
    )
    image_path: Optional[str] = Field(
        default=None,
        description="Path to a screenshot file on disk. (Not yet consumed in this stub.)",
    )


class InferResponse(BaseModel):
    text: str
    model_id: str


def build_prompt(payload: InferRequest) -> str:
    sections = [
        "[SYSTEM] You are UI-TARS, an assistant that detects deceptive dark patterns.",
        f"[INSTRUCTION]\n{payload.instruction}",
    ]
    if payload.dom_snapshot:
        sections.append(f"[DOM]\n{payload.dom_snapshot[:4000]}")
    if payload.evidence:
        sections.append("[EVIDENCE]\n" + "\n".join(payload.evidence))
    if payload.image_path:
        sections.append(f"[SCREENSHOT] {payload.image_path}")
    sections.append("[RESPONSE]")
    return "\n\n".join(sections)


def load_model(model_path: Path) -> tuple[Any, Any]:
    if not model_path.exists():
        raise FileNotFoundError(
            f"Model directory {model_path} does not exist. "
            "Download UI-TARS 1.5 7B weights first."
        )

    tokenizer = AutoTokenizer.from_pretrained(model_path)
    model = AutoModelForCausalLM.from_pretrained(
        model_path,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        device_map="auto",
    )
    return tokenizer, model


MODEL_PATH = Path(os.environ.get("UI_TARS_MODEL_PATH", DEFAULT_MODEL_PATH))
TOKENIZER, MODEL = load_model(MODEL_PATH)
APP_VERSION = os.environ.get("UI_TARS_APP_VERSION", "dev")

app = FastAPI(title="UI-TARS Local Server", version=APP_VERSION)


@app.get("/health")
def health_check() -> dict[str, str]:
    return {"status": "ok", "model_path": str(MODEL_PATH)}


@app.post("/infer", response_model=InferResponse)
def infer(payload: InferRequest) -> InferResponse:
    try:
        prompt = build_prompt(payload)
        inputs = TOKENIZER(
            prompt,
            return_tensors="pt",
            truncation=True,
            max_length=4096,
        )
        inputs = {k: v.to(MODEL.device) for k, v in inputs.items()}
        with torch.inference_mode():
            output = MODEL.generate(
                **inputs,
                max_new_tokens=512,
                temperature=0.2,
                do_sample=False,
            )
        text = TOKENIZER.decode(output[0], skip_special_tokens=True)
        response = text.split("[RESPONSE]", maxsplit=1)[-1].strip()
        return InferResponse(text=response, model_id=str(MODEL_PATH))
    except Exception as exc:  # pragma: no cover - defensive logging
        raise HTTPException(status_code=500, detail=str(exc)) from exc


