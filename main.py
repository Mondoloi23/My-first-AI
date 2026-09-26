import json
import os
import sqlite3
import uuid
from pathlib import Path
from typing import Any, Dict, List

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from openai import OpenAI
from pydantic import BaseModel, Field

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")

API_KEY = os.getenv("OPENROUTER_API_KEY")
MODEL = os.getenv("OPENROUTER_MODEL", "openrouter/free")
DB_PATH = BASE_DIR / "my_ai.db"

if not API_KEY:
    raise RuntimeError("OPENROUTER_API_KEY is missing. Create .env from .env.example.")

client = OpenAI(
    api_key=API_KEY,
    base_url="https://openrouter.ai/api/v1",
    default_headers={
        "HTTP-Referer": os.getenv("APP_URL", "http://localhost:8000"),
        "X-Title": os.getenv("APP_NAME", "My AI v5"),
    },
)

app = FastAPI(title="My AI v5 API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory=BASE_DIR / "static"), name="static")


def db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS chats (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY(chat_id) REFERENCES chats(id) ON DELETE CASCADE
        )
    """)
    conn.commit()
    conn.close()


init_db()


class ChatCreate(BaseModel):
    title: str = "New chat"


class MessageCreate(BaseModel):
    role: str
    content: str


class Settings(BaseModel):
    model: str = "openrouter/free"
    temperature: float = Field(default=0.7, ge=0, le=2)


SYSTEM_PROMPT = (
    "You are My AI, a helpful, accurate and concise personal AI assistant. "
    "Explain difficult subjects clearly. Use Markdown when useful. "
    "For code, provide clear explanations and safe, runnable examples. "
    "Do not claim to have performed actions or accessed information you do not have."
)


@app.get("/")
def root():
    return FileResponse(BASE_DIR / "index.html")


@app.get("/api/health")
def health():
    return {"status": "ok", "provider": "openrouter", "model": MODEL}


@app.get("/api/chats")
def list_chats():
    conn = db()
    rows = conn.execute(
        "SELECT id, title, created_at, updated_at FROM chats ORDER BY updated_at DESC"
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]


@app.post("/api/chats")
def create_chat(data: ChatCreate):
    chat_id = str(uuid.uuid4())
    title = data.title.strip()[:80] or "New chat"
    conn = db()
    conn.execute("INSERT INTO chats (id, title) VALUES (?, ?)", (chat_id, title))
    conn.commit()
    row = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
    conn.close()
    return dict(row)


@app.patch("/api/chats/{chat_id}")
def rename_chat(chat_id: str, data: ChatCreate):
    title = data.title.strip()[:80] or "New chat"
    conn = db()
    cur = conn.execute(
        "UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        (title, chat_id),
    )
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Chat not found")
    return {"ok": True}


@app.delete("/api/chats/{chat_id}")
def delete_chat(chat_id: str):
    conn = db()
    conn.execute("DELETE FROM messages WHERE chat_id = ?", (chat_id,))
    cur = conn.execute("DELETE FROM chats WHERE id = ?", (chat_id,))
    conn.commit()
    conn.close()
    if cur.rowcount == 0:
        raise HTTPException(404, "Chat not found")
    return {"ok": True}


@app.get("/api/chats/{chat_id}/messages")
def get_messages(chat_id: str):
    conn = db()
    chat = conn.execute("SELECT * FROM chats WHERE id = ?", (chat_id,)).fetchone()
    if not chat:
        conn.close()
        raise HTTPException(404, "Chat not found")
    rows = conn.execute(
        "SELECT role, content, created_at FROM messages WHERE chat_id = ? ORDER BY id",
        (chat_id,),
    ).fetchall()
    conn.close()
    return {"chat": dict(chat), "messages": [dict(row) for row in rows]}


@app.post("/api/chats/{chat_id}/messages")
def add_message(chat_id: str, data: MessageCreate):
    if data.role not in {"user", "assistant"}:
        raise HTTPException(400, "Invalid role")
    conn = db()
    exists = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
    if not exists:
        conn.close()
        raise HTTPException(404, "Chat not found")

    conn.execute(
        "INSERT INTO messages (chat_id, role, content) VALUES (?, ?, ?)",
        (chat_id, data.role, data.content),
    )

    if data.role == "user":
        count = conn.execute(
            "SELECT COUNT(*) AS c FROM messages WHERE chat_id = ?", (chat_id,)
        ).fetchone()["c"]
        if count == 1:
            title = data.content.strip().replace("\n", " ")[:60] or "New chat"
            conn.execute(
                "UPDATE chats SET title = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (title, chat_id),
            )
        else:
            conn.execute(
                "UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (chat_id,),
            )

    conn.commit()
    conn.close()
    return {"ok": True}


@app.post("/api/chats/{chat_id}/stream")
def stream_chat(chat_id: str, settings: Settings):
    conn = db()
    exists = conn.execute("SELECT id FROM chats WHERE id = ?", (chat_id,)).fetchone()
    rows = conn.execute(
        "SELECT role, content FROM messages WHERE chat_id = ? ORDER BY id",
        (chat_id,),
    ).fetchall()
    conn.close()

    if not exists:
        raise HTTPException(404, "Chat not found")

    conversation: List[Dict[str, Any]] = [{"role": "system", "content": SYSTEM_PROMPT}]
    conversation.extend({"role": r["role"], "content": r["content"]} for r in rows)

    def generate():
        try:
            stream = client.chat.completions.create(
                model=settings.model or MODEL,
                messages=conversation,
                stream=True,
                temperature=settings.temperature,
            )
            for chunk in stream:
                if not chunk.choices:
                    continue
                content = getattr(chunk.choices[0].delta, "content", None)
                if content:
                    yield f"data: {json.dumps({'content': content})}\n\n"
            yield "data: [DONE]\n\n"
        except Exception as exc:
            yield f"data: {json.dumps({'error': str(exc)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
