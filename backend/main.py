"""
SentientStudy - Simple web server.
Run: cd backend && python main.py
Open: http://localhost:8000
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
import uvicorn
import os

from database import create_session, end_session, get_connection
from capture_engine import engine

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

    # Auto-heal abandoned sessions
    print("[server] Auto-healing abandoned sessions...")
    try:
        conn = get_connection()
        conn.execute("UPDATE sessions SET end_time = start_time WHERE end_time IS NULL")
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

# --- State ---
class AppState:
    active_session_id = None
    is_recording = False
    is_processing = False

state = AppState()

class StartRequest(BaseModel):
    title: str = "Study Session"

# --- Routes ---
@app.get("/")
def read_root():
    return FileResponse(os.path.join(FRONTEND_DIR, "dashboard.html"))

# --- API ---
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

    background_tasks.add_task(engine.stop, on_done_callback=on_done)
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
        # Use DISTINCT to avoid duplicates (though id is primary key, just in case)
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
        # First delete related session_data
        conn.execute("DELETE FROM session_data WHERE session_id=?", (session_id,))
        # Then delete the session itself
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

# Serve static files (must be last)
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")

if __name__ == "__main__":
    print("=" * 40)
    print("  SentientStudy - http://localhost:8000")
    print("=" * 40)
    uvicorn.run(app, host="127.0.0.1", port=8000)
