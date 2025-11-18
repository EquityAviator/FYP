"""
LoRA fine-tuning entry point for UI-TARS 1.5 7B using HuggingFace Transformers.

Example:
    python scripts/train_lora.py \
        --model-path ../../models/ui-tars-1.5-7b \
        --dataset datasets/run-001/processed.jsonl \
        --output-dir ../../models/ui-tars-1.5-7b-finetuned
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import torch
from datasets import load_dataset
from peft import LoraConfig, TaskType, get_peft_model
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    DataCollatorForLanguageModeling,
    Trainer,
    TrainingArguments,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True, type=Path)
    parser.add_argument("--dataset", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--learning-rate", type=float, default=2e-5)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--grad-accum", type=int, default=8)
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--lora-r", type=int, default=64)
    parser.add_argument("--lora-alpha", type=int, default=16)
    parser.add_argument("--lora-dropout", type=float, default=0.05)
    return parser.parse_args()


def build_prompt(record: dict) -> str:
    prompt = record["prompt"]
    label = record["label"]
    return f"{prompt}\n{label}"


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    tokenizer = AutoTokenizer.from_pretrained(args.model_path)
    tokenizer.padding_side = "right"
    tokenizer.pad_token = tokenizer.eos_token

    base_model = AutoModelForCausalLM.from_pretrained(
        args.model_path,
        torch_dtype=torch.float16 if torch.cuda.is_available() else torch.float32,
        device_map="auto",
    )

    lora_config = LoraConfig(
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj"],
        lora_dropout=args.lora_dropout,
        bias="none",
        task_type=TaskType.CAUSAL_LM,
    )
    model = get_peft_model(base_model, lora_config)

    dataset = load_dataset("json", data_files=str(args.dataset))

    def preprocess(batch):
        text = build_prompt(batch)
        tokenized = tokenizer(
            text,
            truncation=True,
            max_length=4096,
            padding="max_length",
        )
        tokenized["labels"] = tokenized["input_ids"].copy()
        return tokenized

    tokenized_dataset = dataset["train"].map(preprocess, remove_columns=dataset["train"].column_names)

    collator = DataCollatorForLanguageModeling(tokenizer=tokenizer, mlm=False)
    training_args = TrainingArguments(
        output_dir=str(args.output_dir),
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum,
        num_train_epochs=args.epochs,
        learning_rate=args.learning_rate,
        fp16=torch.cuda.is_available(),
        logging_steps=10,
        save_strategy="epoch",
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        data_collator=collator,
        train_dataset=tokenized_dataset,
    )
    trainer.train()
    trainer.save_model()
    tokenizer.save_pretrained(args.output_dir)

    metadata_path = args.output_dir / "dataset.json"
    metadata_path.write_text(
        json.dumps({"dataset": str(args.dataset), "epochs": args.epochs}, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()


