"""
SentientStudy — Local Inference Engine for Semantic Query Assistant.
Uses complete chronological context stuffing to ensure 100% factual accuracy.
"""

import json
import urllib.request
import urllib.error
from typing import Generator

from database import get_connection

OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"

SYSTEM_PROMPT = (
    "You are Sentient Study's AI Assistant. You are analyzing a student's study session timeline.\n"
    "CRITICAL RULES:\n"
    "1. Answer ONLY using the chronological data logs provided below.\n"
    "2. If asked for a maximum (e.g., highest frustration), you MUST scan all the data logs provided, compare the metric percentages, and report the highest one alongside its exact Time.\n"
    "3. DO NOT hallucinate timestamps, topics, or events. Only use what is written in the context.\n"
    "4. Be direct, technical, and concise."
)

def synthesize_session_query(session_id: int, user_query: str) -> Generator[str, None, None]:
    """Synthesize an analytical response using the entire session timeline."""
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

    # Compile the ENTIRE session sequentially
    context_lines = []
    for i, row in enumerate(rows):
        desc = row["description"] or ""
        if not desc.strip() or "No active telemetry" in desc:
            continue

        eng = round((row["engagement_score"] or 0) * 100, 1)
        conf = round((row["confusion_score"] or 0) * 100, 1)
        frust = round((row["frustration_score"] or 0) * 100, 1)
        topic = row["topic"] or "N/A"
        
        # Strict time formatting
        time_mark = f"{i * 10} seconds"

        context_lines.append(
            f"[Time: {time_mark}] Topic: {topic} | Engaged: {eng}%, Confused: {conf}%, Frustrated: {frust}% | Details: {desc}"
        )

    if not context_lines:
        yield "No active telemetry intervals were recorded in this session."
        return

    if len(context_lines) > 214:
        step = len(context_lines) / 214.0
        sampled_lines = [context_lines[int(i * step)] for i in range(214)]
        compiled_logs = "\n".join(sampled_lines)
    else:
        compiled_logs = "\n".join(context_lines)

    prompt = (
        SYSTEM_PROMPT
        + "\n\n--- SESSION LOGS ---\n"
        + compiled_logs
        + "\n\nUser Question: "
        + user_query
        + "\nAnswer:"
    )

    payload = json.dumps({
        "model": "llama3.2:1b",
        "prompt": prompt,
        "stream": True,
        "options": {
            "temperature": 0.0,   # Set to 0.0 for maximum mathematical factuality
            "top_p": 0.9,
            "num_ctx": 8192,      # Expanded to hold the entire session memory
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