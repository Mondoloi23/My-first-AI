import os
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from openai import OpenAI

load_dotenv()

app = FastAPI(title="My AI Assistant")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM_PROMPT = """You are My AI, a helpful personal AI assistant.
Be clear, accurate, practical, and concise.
Use the conversation history to maintain context.
If you are unsure about something, say so rather than inventing facts.
"""

class ChatRequest(BaseModel):
    messages: list[dict]

@app.get("/")
def home():
    return {"message": "My AI backend is running"}

@app.post("/chat")
def chat(request: ChatRequest):
    if not os.getenv("OPENAI_API_KEY"):
        return {"reply": "Server error: OPENAI_API_KEY is not configured."}

    try:
        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            *request.messages[-20:],
        ]

        response = client.responses.create(
            model="gpt-5.6-mini",
            input=messages,
        )

        return {"reply": response.output_text}

    except Exception as error:
        print("AI error:", error)
        return {"reply": "Sorry, I couldn't reach the AI service right now."}

@app.post("/chat/stream")
def chat_stream(request: ChatRequest):
    if not os.getenv("OPENAI_API_KEY"):
        return StreamingResponse(
            iter(["Server error: OPENAI_API_KEY is not configured."]),
            media_type="text/plain",
        )

    def generate():
        try:
            messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                *request.messages[-20:],
            ]

            stream = client.responses.create(
                model="gpt-5.6-mini",
                input=messages,
                stream=True,
            )

            for event in stream:
                if event.type == "response.output_text.delta":
                    yield event.delta

        except Exception as error:
            print("Streaming error:", error)
            yield "\n\n[The AI connection was interrupted.]"

    return StreamingResponse(generate(), media_type="text/plain")
