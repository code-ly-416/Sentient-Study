"""
SentientStudy — Database layer (SQLite)
"""

import sqlite3
import os
from datetime import datetime

# Resolve path relative to project root (one level up from /backend)
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DB_PATH = os.path.join(PROJECT_ROOT, "data", "sentient.db")

# Ensure the data directory exists
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)


def get_connection() -> sqlite3.Connection:
    """Return a new SQLite connection with Row factory and WAL mode enabled."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False, timeout=15)
    conn.row_factory = sqlite3.Row
    # Enable Write-Ahead Logging for simultaneous reads and writes
    conn.execute("PRAGMA journal_mode=WAL")
    # Optimize disk writes without sacrificing data integrity
    conn.execute("PRAGMA synchronous=NORMAL")
    return conn


def init_db():
    """Create tables if they don't already exist."""
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()

        cur.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                start_time DATETIME NOT NULL,
                end_time   DATETIME,
                title      TEXT
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS session_data (
                id                INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id        INTEGER NOT NULL,
                timestamp         DATETIME NOT NULL,
                engagement_score  REAL,
                confusion_score   REAL,
                frustration_score REAL,
                screen_text       TEXT,
                audio_text        TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions (id)
            )
        """)

        conn.commit()
    finally:
        if conn:
            conn.close()


def create_session(title: str = "Study Session") -> int:
    """Insert a new session row and return its id."""
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "INSERT INTO sessions (start_time, title) VALUES (?, ?)",
            (datetime.now().isoformat(), title),
        )
        session_id = cur.lastrowid
        conn.commit()
        return session_id
    finally:
        if conn:
            conn.close()


def end_session(session_id: int):
    """Set the end_time on an existing session."""
    conn = None
    try:
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            "UPDATE sessions SET end_time = ? WHERE id = ?",
            (datetime.now().isoformat(), session_id),
        )
        conn.commit()
    finally:
        if conn:
            conn.close()


# Auto-initialise on import
init_db()
