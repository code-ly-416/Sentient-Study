"""
SentientStudy — Vector Embedding Utilities for RAG pipeline.
Uses Ollama's nomic-embed-text for local embedding generation and NumPy for cosine similarity.
"""

import json
import os
import urllib.request
import urllib.error

import numpy as np

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EMBEDDINGS_DIR = os.path.join(PROJECT_ROOT, "data", "embeddings")

# Upgraded to modern embed endpoint
OLLAMA_EMBED_ENDPOINT = "http://127.0.0.1:11434/api/embed"
EMBED_MODEL = "nomic-embed-text"


def get_ollama_embedding(text: str) -> list[float]:
    """Generate an embedding vector from text using Ollama's nomic-embed-text model."""
    payload = json.dumps({
        "model": EMBED_MODEL,
        "input": text,  # Modern API uses 'input'
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_EMBED_ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            body = json.loads(resp.read().decode("utf-8"))
            return body["embeddings"][0]
    except urllib.error.HTTPError as e:
        error_msg = e.read().decode('utf-8')
        # This will explicitly tell you if the model is missing
        raise RuntimeError(f"Ollama rejected the request ({e.code}): {error_msg}. Did you run 'ollama pull {EMBED_MODEL}'?")
    except urllib.error.URLError:
        raise RuntimeError("Ollama service is unreachable. Is it running in your system tray?")


def save_session_embedding(session_id: int, timestamp: str, embedding: list[float]):
    """Persist a timestamped embedding vector to the session's JSON file."""
    os.makedirs(EMBEDDINGS_DIR, exist_ok=True)
    filepath = os.path.join(EMBEDDINGS_DIR, f"session_{session_id}.json")

    entries = []
    if os.path.exists(filepath):
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                entries = json.load(f)
        except (json.JSONDecodeError, IOError):
            entries = []

    entries.append({"timestamp": timestamp, "embedding": embedding})

    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(entries, f)


def get_top_k_chunks(session_id: int, query_embedding: list[float], k: int = 5) -> list[str]:
    """Return the top-k most relevant timestamps via cosine similarity lookup."""
    filepath = os.path.join(EMBEDDINGS_DIR, f"session_{session_id}.json")

    if not os.path.exists(filepath):
        return []

    try:
        with open(filepath, "r", encoding="utf-8") as f:
            entries = json.load(f)
    except (json.JSONDecodeError, IOError):
        return []

    if not entries:
        return []

    query_vec = np.array(query_embedding, dtype=np.float32)
    query_norm = np.linalg.norm(query_vec)
    if query_norm == 0:
        return []

    scored = []
    for entry in entries:
        doc_vec = np.array(entry["embedding"], dtype=np.float32)
        doc_norm = np.linalg.norm(doc_vec)
        if doc_norm == 0:
            continue
        similarity = np.dot(query_vec, doc_vec) / (query_norm * doc_norm)
        scored.append((entry["timestamp"], float(similarity)))

    scored.sort(key=lambda x: x[1], reverse=True)
    return [ts for ts, _ in scored[:k]]