"""Regenerate CLIP category vectors from verified local assets; never downloads anything.

Developer dependencies: numpy, onnxruntime==1.24.2, tokenizers.
Example: python scripts/generate-category-embeddings.py --asset-dir .tools/classification-downloads
The text encoder is a development asset and is not shipped with Metaflow.
"""

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
import onnxruntime as ort
from tokenizers import Tokenizer


REVISION = "d15189d7028b43f1d3e65039190477f6af591c2a"
TEXT_SHA = "df587ffbf248bf20d44fa6e16adc5ebc27ead691860e5333dbdaab5fd6bf3f6e"
TOKENIZER_SHA = "f7f3b7af117d467b58374797691a6438d3e6b9e9cef800dfd5dced7f697a90cd"
PROMPTS = {
    "people": [
        "A photograph of a person or a group of people.",
        "A personal photograph of real people, friends or family.",
        "A portrait or selfie photograph.",
    ],
    "animals": [
        "A photograph of an animal, a pet, a cat or a dog.",
        "A photograph of wildlife or birds.",
        "A photograph showing animals.",
    ],
    "screenshots": [
        "A screenshot of a phone or computer screen, apps, menus or messages.",
        "A screen capture showing a website or user interface.",
        "A screenshot of a chat conversation, social media app or video game.",
    ],
    "memes": [
        "An internet meme with funny text and a reaction image.",
        "A humorous meme, cartoon or joke shared on social media.",
        "A picture with an overlaid joke or funny caption.",
    ],
    "documents": [
        "A photograph or scan of a document, receipt, printed paper or handwritten notes.",
        "A photo of text on a page, a form, an invoice or a receipt.",
        "A scanned written document or printed page.",
    ],
    "landscapes": [
        "A photograph of scenery, a landscape, mountains, nature or a beach.",
        "A photograph of a city, buildings or a travel destination.",
        "A landscape photograph.",
    ],
    "objects": [
        "A photograph of an everyday object, product, vehicle, food or household item.",
        "A photo of things, a meal or an object.",
        "A product photograph.",
    ],
    "other": [
        "An abstract graphic, illustration, icon or wallpaper.",
        "A drawing, painting or digital art image.",
        "A miscellaneous picture.",
    ],
}


def verified_asset(directory: Path, name: str, size: int, expected_sha: str) -> Path:
    path = directory / name
    if not path.is_file() or path.is_symlink() or path.stat().st_size != size:
        raise ValueError(f"Missing or invalid development asset: {name}")
    digest = hashlib.sha256()
    with path.open("rb") as asset:
        for block in iter(lambda: asset.read(1_048_576), b""):
            digest.update(block)
    if digest.hexdigest() != expected_sha:
        raise ValueError(f"SHA-256 mismatch: {name}")
    return path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--asset-dir", required=True, type=Path)
    args = parser.parse_args()
    encoder = verified_asset(args.asset_dir, "text_model_fp16.onnx", 127_339_794, TEXT_SHA)
    tokenizer_path = verified_asset(args.asset_dir, "tokenizer.json", 2_224_119, TOKENIZER_SHA)

    tokenizer = Tokenizer.from_file(str(tokenizer_path))
    tokenizer.enable_truncation(max_length=77)
    tokenizer.enable_padding(length=77, pad_id=49407, pad_token="<|endoftext|>")
    options = ort.SessionOptions()
    options.intra_op_num_threads = 2
    options.inter_op_num_threads = 1
    # ORT 1.24.2's FP16 LayerNormFusion breaks this graph. This offline encoder
    # uses the unfused reference graph; the bundled vision session stays optimized.
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    ort.disable_telemetry_events()
    session = ort.InferenceSession(
        str(encoder), sess_options=options, providers=["CPUExecutionProvider"]
    )
    categories = []
    for category, texts in PROMPTS.items():
        encoded = tokenizer.encode_batch(texts)
        inputs = {
            "input_ids": np.asarray([value.ids for value in encoded], dtype=np.int64),
            "attention_mask": np.asarray(
                [value.attention_mask for value in encoded], dtype=np.int64
            ),
        }
        inputs = {value.name: inputs[value.name] for value in session.get_inputs()}
        output = session.run(["text_embeds"], inputs)[0].astype(np.float32)
        norms = np.linalg.norm(output, axis=1, keepdims=True)
        if output.shape != (len(texts), 512) or not np.all(np.isfinite(output)):
            raise ValueError(f"Invalid output for {category}")
        if not np.all(np.isfinite(norms)) or np.any(norms < 1e-8):
            raise ValueError(f"Invalid embedding norm for {category}")
        output /= norms
        categories.append(
            {
                "id": category,
                "prompts": texts,
                "embeddings": [[round(float(value), 9) for value in row] for row in output],
            }
        )
    result = {
        "model": "clip-vit-base-patch32",
        "sourceRevision": REVISION,
        "textEncoder": "text_model_fp16.onnx",
        "textEncoderSha256": TEXT_SHA,
        "categories": categories,
    }
    root = Path(__file__).resolve().parent.parent
    destination = root / "src-tauri" / "resources" / "category-embeddings.json"
    data = json.dumps(result, separators=(",", ":")).encode("utf-8")
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_bytes(data)
    bundled = destination.parent / "classification" / destination.name
    if bundled.parent.is_dir():
        bundled.write_bytes(data)
    print(f"Generated {destination}")
    print(f"SHA-256: {hashlib.sha256(data).hexdigest()}")


if __name__ == "__main__":
    main()
