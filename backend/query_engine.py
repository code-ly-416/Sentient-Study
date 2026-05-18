"""
SentientStudy — Local Inference Engine for Semantic Query Assistant.
Uses Intent Routing (SQL + LLM) for mathematical precision and context compression for conceptual queries.
"""

import json
import urllib.request
import urllib.error
from typing import Generator

from database import get_connection

OLLAMA_ENDPOINT = "http://127.0.0.1:11434/api/generate"

ROUTER_PROMPT = """Analyze the user's query and classify it into exactly ONE of the following strict categories based on their intent.

CATEGORIES:
PEAK_FRUSTRATION - (e.g., "when was I most frustrated?", "highest frustration spike")
PEAK_CONFUSION - (e.g., "when was I most confused?", "highest confusion")
PEAK_ENGAGEMENT - (e.g., "when was I most engaged?", "peak engagement")
AVERAGE_METRICS - (e.g., "what was my average score?", "overall engagement", "average metrics")
CONCEPT - (e.g., "summarize the lecture", "what did I study?", "explain the topic", "what happened")

User Query: "{query}"

Output ONLY the exact category name. Do not add punctuation or explanations."""

SYSTEM_PROMPT_CONCEPT = (
    "You are Sentient Study's AI Assistant. You are analyzing a student's study session timeline.\n"
    "Answer ONLY using the chronological data logs provided below.\n"
    "Be direct, technical, and concise. Do not hallucinate."
)

SYSTEM_PROMPT_MATH = (
    "You are Sentient Study's AI Assistant. I have queried the database and calculated the exact mathematical answer to the user's question.\n"
    "Convert the raw database results provided below into a natural, direct, and concise sentence for the user.\n"
    "Do not hallucinate any other data."
)

def _call_ollama_sync(prompt: str, max_tokens: int = 20) -> str:
    """Fast, synchronous call to Ollama to classify query intent."""
    payload = json.dumps({
        "model": "llama3.2:1b",
        "prompt": prompt,
        "stream": False,
        "options": {"temperature": 0.0, "num_predict": max_tokens}
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_ENDPOINT, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            return data.get("response", "").strip().upper()
    except Exception:
        return "CONCEPT"  # Safe fallback if router fails


def synthesize_session_query(session_id: int, user_query: str) -> Generator[str, None, None]:
    conn = None
    prompt = ""
    
    try:
        conn = get_connection()
        
        # Guard clause for empty sessions
        count = conn.execute("SELECT COUNT(*) FROM session_data WHERE session_id = ?", (session_id,)).fetchone()[0]
        if count == 0:
            yield "No telemetry data found for this session."
            return

        # 1. ROUTING PHASE
        formatted_router_prompt = ROUTER_PROMPT.format(query=user_query)
        raw_intent = _call_ollama_sync(formatted_router_prompt)
        
        # Clean the intent vector
        valid_intents = ["PEAK_FRUSTRATION", "PEAK_CONFUSION", "PEAK_ENGAGEMENT", "AVERAGE_METRICS"]
        matched_intent = "CONCEPT"
        for vi in valid_intents:
            if vi in raw_intent:
                matched_intent = vi
                break
                
        # 2. MATH / SQL EXECUTION PHASE
        if matched_intent != "CONCEPT":
            db_context = ""
            if matched_intent == "PEAK_FRUSTRATION":
                row = conn.execute("SELECT timestamp, frustration_score, topic FROM session_data WHERE session_id = ? ORDER BY frustration_score DESC LIMIT 1", (session_id,)).fetchone()
                db_context = f"Peak Frustration: {round(row['frustration_score']*100, 1)}% at {row['timestamp']}. Topic Context: {row['topic']}"
            elif matched_intent == "PEAK_CONFUSION":
                row = conn.execute("SELECT timestamp, confusion_score, topic FROM session_data WHERE session_id = ? ORDER BY confusion_score DESC LIMIT 1", (session_id,)).fetchone()
                db_context = f"Peak Confusion: {round(row['confusion_score']*100, 1)}% at {row['timestamp']}. Topic Context: {row['topic']}"
            elif matched_intent == "PEAK_ENGAGEMENT":
                row = conn.execute("SELECT timestamp, engagement_score, topic FROM session_data WHERE session_id = ? ORDER BY engagement_score DESC LIMIT 1", (session_id,)).fetchone()
                db_context = f"Peak Engagement: {round(row['engagement_score']*100, 1)}% at {row['timestamp']}. Topic Context: {row['topic']}"
            elif matched_intent == "AVERAGE_METRICS":
                row = conn.execute("SELECT AVG(engagement_score) as avg_e, AVG(confusion_score) as avg_c, AVG(frustration_score) as avg_f FROM session_data WHERE session_id = ?", (session_id,)).fetchone()
                db_context = f"Session Averages -> Engagement: {round(row['avg_e']*100, 1)}%, Confusion: {round(row['avg_c']*100, 1)}%, Frustration: {round(row['avg_f']*100, 1)}%"

            prompt = f"{SYSTEM_PROMPT_MATH}\n\nRaw Database Result:\n{db_context}\n\nUser Question: {user_query}\nAnswer:"
            
        # 3. CONCEPTUAL COMPRESSION PHASE
        else:
            rows = conn.execute(
                "SELECT timestamp, engagement_score, confusion_score, frustration_score, topic, description "
                "FROM session_data WHERE session_id = ? ORDER BY timestamp ASC",
                (session_id,),
            ).fetchall()

            context_lines = []
            for i, row in enumerate(rows):
                desc = row["description"] or ""
                if not desc.strip() or "No active telemetry" in desc:
                    continue
                eng = round((row["engagement_score"] or 0) * 100, 1)
                conf = round((row["confusion_score"] or 0) * 100, 1)
                frust = round((row["frustration_score"] or 0) * 100, 1)
                topic = row["topic"] or "N/A"
                time_mark = f"{i * 10} seconds"
                context_lines.append(f"[Time: {time_mark}] Topic: {topic} | Engaged: {eng}%, Confused: {conf}%, Frustrated: {frust}% | Details: {desc}")

            if not context_lines:
                yield "No active telemetry intervals were recorded in this session."
                return

            # Strict Context Compression to prevent 8192 token limit crash on sessions > 35 minutes
            max_safe_chunks = 214
            if len(context_lines) > max_safe_chunks:
                step = len(context_lines) / max_safe_chunks
                compressed_lines = [context_lines[int(i * step)] for i in range(max_safe_chunks)]
                compiled_logs = "\n".join(compressed_lines)
            else:
                compiled_logs = "\n".join(context_lines)

            prompt = f"{SYSTEM_PROMPT_CONCEPT}\n\n--- SESSION LOGS ---\n{compiled_logs}\n\nUser Question: {user_query}\nAnswer:"

    finally:
        if conn:
            conn.close()

    # 4. STREAMING PHASE (Executes for both routes)
    payload = json.dumps({
        "model": "llama3.2:1b",
        "prompt": prompt,
        "stream": True,
        "options": {
            "temperature": 0.0,
            "top_p": 0.9,
            "num_ctx": 8192,
        },
    }).encode("utf-8")

    req = urllib.request.Request(
        OLLAMA_ENDPOINT, data=payload, headers={"Content-Type": "application/json"}, method="POST"
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