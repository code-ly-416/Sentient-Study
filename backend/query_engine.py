"""
SentientStudy — Local Inference Engine for Semantic Query Assistant.
Uses a local Ollama instance running llama3.2:1b for on-device session analysis.
"""

import json
import urllib.request
import urllib.error
from typing import Generator

from database import get_connection

OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"

SYSTEM_PROMPT = (
    "You are the core analytical brain of Sentient Study, an on-device affective computing system "
    "that monitors student engagement, confusion, and frustration during study sessions. "
    "You receive strictly technical, chronological session telemetry logs. "
    "Respond with precise, data-driven analysis based only on the provided logs. "
    "Do not speculate beyond the data. Do not engage in casual conversation. "
    "Reference specific timestamps, metric values, and topic context when forming conclusions."
)


def synthesize_session_query(session_id: int, user_query: str) -> Generator[str, None, None]:
    """Synthesize an analytical response using a byte-streamed local LLM inference."""
    conn = None
    try:
        conn = get_connection()
        rows = conn.execute(
            "SELECT timestamp, engagement_score, confusion_score, frustration_score, topic, description "
            "FROM session_data WHERE session_id = ? ORDER BY timestamp ASC",
            (session_id,),
        ).fetchall()
    finally:
        if conn:
            conn.close()

    if not rows:
        yield "No telemetry data found for this session."
        return

    # Compress context payload — skip empty/inactive intervals
    context_lines = []
    for i, row in enumerate(rows):
        desc = row["description"] or ""
        if not desc.strip() or desc.strip() == "No active telemetry logged during this interval.":
            continue

        eng = round((row["engagement_score"] or 0) * 100, 1)
        conf = round((row["confusion_score"] or 0) * 100, 1)
        frust = round((row["frustration_score"] or 0) * 100, 1)
        topic = row["topic"] or "N/A"
        offset = i * 10

        context_lines.append(
            f"[{offset}s] Topic: {topic} | Metrics -> Engaged: {eng}%, Confused: {conf}%, Frustrated: {frust}%\n"
            f"  Context: {desc}"
        )

    if not context_lines:
        yield "No active telemetry intervals were recorded in this session."
        return

    compiled_logs = "\n".join(context_lines)

    prompt = (
        SYSTEM_PROMPT
        + "\n\n"
        + compiled_logs
        + "\n\nUser Query: "
        + user_query
    )

    payload = json.dumps({
        "model": "llama3.2:1b",
        "prompt": prompt,
        "stream": True,  # Streaming activated
        "options": {
            "temperature": 0.3,
            "top_p": 0.9,
            "num_ctx": 4096,
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=120) as resp:
            # Yield bytes line-by-line as Ollama computes them
            for line in resp:
                if line:
                    data = json.loads(line.decode("utf-8"))
                    if "response" in data:
                        yield data["response"]
    except urllib.error.HTTPError as e:
        error_msg = e.read().decode('utf-8')
        yield f"\n[Ollama API Error ({e.code}): {error_msg}]"
    except urllib.error.URLError:
        yield "\n[⚠ Ollama is unreachable. Is the service running in your system tray?]"
    except Exception as e:
        yield f"\n[Inference error: {e}]"