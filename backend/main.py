"""
SentientStudy - Simple web server.
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
import uvicorn
import os

from database import create_session, end_session, get_connection, update_session_title, update_session_key_topic
from capture_engine import engine
from nlp_utils import extract_smart_title, generate_context_description, extract_session_key_topic
from query_engine import synthesize_session_query

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FRONTEND_DIR = os.path.join(PROJECT_ROOT, "frontend")

import shutil
from contextlib import asynccontextmanager


@asynccontextmanager
async def lifespan(app: FastAPI):
    temp_dir = os.path.join(PROJECT_ROOT, "data", "temp")
    if os.path.exists(temp_dir):
        print(f"[server] Cleaning up legacy temp directory: {temp_dir}")
        try:
            shutil.rmtree(temp_dir)
            os.makedirs(temp_dir, exist_ok=True)
            print("[server] Cleanup complete.")
        except Exception as e:
            print(f"[server] Failed to clean up temp dir: {e}")

    print("[server] Auto-healing abandoned sessions...")
    try:
        conn = get_connection()
        conn.execute("UPDATE sessions SET end_time = start_time WHERE end_time IS NULL")
        conn.commit()

        rows = conn.execute(
            "SELECT id, screen_text, audio_text FROM session_data WHERE topic IS NULL"
        ).fetchall()
        if rows:
            print(f"[server] Backfilling topic for {len(rows)} session_data rows...")
            for row in rows:
                text_list = []
                if row["screen_text"]:
                    text_list.append(row["screen_text"])
                if row["audio_text"]:
                    text_list.append(row["audio_text"])
                topic = extract_smart_title(text_list)
                conn.execute(
                    "UPDATE session_data SET topic=? WHERE id=?",
                    (topic, row["id"]),
                )
            conn.commit()

        desc_rows = conn.execute(
            "SELECT id, screen_text, audio_text FROM session_data WHERE description IS NULL"
        ).fetchall()
        if desc_rows:
            print(f"[server] Backfilling description for {len(desc_rows)} session_data rows...")
            for row in desc_rows:
                description = generate_context_description(row["screen_text"] or "", row["audio_text"] or "")
                conn.execute(
                    "UPDATE session_data SET description=? WHERE id=?",
                    (description, row["id"]),
                )
            conn.commit()

        # Migrate session key_topic using pre-computed chunk topics
        session_rows = conn.execute("SELECT id FROM sessions WHERE key_topic IS NULL OR key_topic = 'N/A'").fetchall()
        if session_rows:
            print(f"[server] Backfilling key_topic for {len(session_rows)} sessions...")
            for row in session_rows:
                sid = row["id"]
                data_rows = conn.execute("SELECT topic FROM session_data WHERE session_id=?", (sid,)).fetchall()
                topics = [drow["topic"] for drow in data_rows if drow["topic"]]
                key_topic = extract_session_key_topic(topics)
                conn.execute("UPDATE sessions SET key_topic=? WHERE id=?", (key_topic, sid))
            conn.commit()

    except Exception as e:
        print(f"[server] Failed to heal sessions: {e}")
    finally:
        if 'conn' in locals() and conn:
            conn.close()

    yield


app = FastAPI(title="SentientStudy", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8000", "http://127.0.0.1:8000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class AppState:
    active_session_id = None
    is_recording = False
    is_processing = False


state = AppState()


class StartRequest(BaseModel):
    title: str = "Study Session"


class AssistantQueryRequest(BaseModel):
    query: str


@app.get("/")
def read_root():
    return FileResponse(os.path.join(FRONTEND_DIR, "dashboard.html"))


@app.post("/api/start")
def start_recording(req: StartRequest):
    if state.is_recording:
        raise HTTPException(400, "Already recording.")
    session_id = create_session(req.title)
    state.active_session_id = session_id
    state.is_recording = True
    engine.start(session_id)
    return {"status": "ok", "session_id": session_id}


@app.post("/api/stop")
def stop_recording(background_tasks: BackgroundTasks):
    if not state.is_recording:
        raise HTTPException(400, "Not recording.")
    end_session(state.active_session_id)
    sid = state.active_session_id
    state.is_recording = False
    state.active_session_id = None
    state.is_processing = True

    def on_done():
        state.is_processing = False
        print("[server] Post-processing complete.")

    def stop_and_title():
        engine.stop(on_done_callback=on_done)
        conn = None
        try:
            conn = get_connection()
            
            # 1. Fetch current title to prevent overwriting user input
            session_row = conn.execute("SELECT title FROM sessions WHERE id=?", (sid,)).fetchone()
            current_title = session_row["title"] if session_row else ""
            
            rows = conn.execute(
                "SELECT screen_text, audio_text, topic FROM session_data WHERE session_id=?",
                (sid,),
            ).fetchall()
            text_list = []
            topics = []
            for row in rows:
                if row["screen_text"]:
                    text_list.append(row["screen_text"])
                if row["audio_text"]:
                    text_list.append(row["audio_text"])
                if row["topic"]:
                    topics.append(row["topic"])
            
            # 2. Only apply smart titling if the user didn't provide a custom name
            if current_title in ["Untitled Study Session", "Study Session", "Untitled Session", ""]:
                smart_title = extract_smart_title(text_list)
                update_session_title(sid, smart_title)
            
            session_key_topic = extract_session_key_topic(topics)
            update_session_key_topic(sid, session_key_topic)
        except Exception as e:
            print(f"[server] Failed to update session title: {e}")
        finally:
            if conn:
                conn.close()

    background_tasks.add_task(stop_and_title)
    return {"status": "ok", "session_id": sid}


@app.get("/api/status")
def get_status():
    return {
        "is_recording": state.is_recording,
        "is_processing": state.is_processing,
        "session_id": state.active_session_id,
    }


@app.get("/api/sessions")
def get_sessions():
    conn = None
    try:
        conn = get_connection()
        rows = conn.execute("SELECT DISTINCT * FROM sessions ORDER BY id DESC").fetchall()
        return {"sessions": [dict(r) for r in rows]}
    finally:
        if conn:
            conn.close()


@app.delete("/api/sessions/{session_id}")
def delete_session(session_id: int):
    conn = None
    try:
        conn = get_connection()
        conn.execute("DELETE FROM session_data WHERE session_id=?", (session_id,))
        conn.execute("DELETE FROM sessions WHERE id=?", (session_id,))
        conn.commit()
        return {"status": "ok", "message": f"Session {session_id} deleted"}
    finally:
        if conn:
            conn.close()


@app.get("/api/results/{session_id}")
def get_results(session_id: int):
    conn = None
    try:
        conn = get_connection()
        rows = conn.execute(
            "SELECT * FROM session_data WHERE session_id=? ORDER BY timestamp", (session_id,)
        ).fetchall()
        return {"data": [dict(r) for r in rows]}
    finally:
        if conn:
            conn.close()


@app.post("/api/query/{session_id}")
def query_session_assistant(session_id: int, req: AssistantQueryRequest):
    """Processes plain text queries and streams the generator directly to the client."""
    if not req.query.strip():
        raise HTTPException(400, "Query cannot be empty.")
    
    return StreamingResponse(
        synthesize_session_query(session_id, req.query.strip()), 
        media_type="text/plain"
    )


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == "__main__":
    print("=" * 40)
    print("  SentientStudy - http://localhost:8000")
    print("=" * 40)
    uvicorn.run(app, host="127.0.0.1", port=8000)