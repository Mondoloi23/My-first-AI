# My AI v5

A more advanced personal AI assistant built with **Python, FastAPI, SQLite, JavaScript, and OpenRouter**.

## What's new in v5

- Persistent SQLite conversation storage
- Multiple chat sessions
- Rename and delete chats
- Streaming AI responses
- Markdown-style response rendering
- Code blocks with copy buttons
- Voice input when supported by the browser
- Model and temperature settings
- Responsive mobile interface
- Server-side API key handling
- Health endpoint for debugging

## 1. Configure OpenRouter

Go to:

**https://openrouter.ai/**

Create/sign in to your account and create an API key.

**Do not send your API key to anyone or put it in frontend files.**

## 2. Create `.env`

Copy:

```text
.env.example
```

to:

```text
.env
```

Then put your key in:

```env
OPENROUTER_API_KEY=YOUR_KEY_HERE
```

The `.env` file is ignored by Git.

## 3. Install dependencies

Use Python 3.10+.

```bash
pip install -r requirements.txt
```

## 4. Start My AI

```bash
uvicorn main:app --reload
```

Open:

```text
http://127.0.0.1:8000
```

## 5. Using v5

- Click **New chat** to create conversations.
- Select chats from the sidebar.
- Use the chat menu to rename or delete a conversation.
- Open **Settings** to change the OpenRouter model and temperature.
- Use the microphone button if your browser supports speech recognition.
- Code responses include a Copy button.

## 6. Model configuration

The default is:

```env
OPENROUTER_MODEL=openrouter/free
```

You can change it either in `.env` or through the My AI Settings panel.

Check OpenRouter's current model catalogue:

**https://openrouter.ai/models**

Model availability, pricing, and limits can change.

## 7. Security

Never:
- Put your API key in `index.html`.
- Put your API key in `static/script.js`.
- Commit `.env` to GitHub.
- Share your API key publicly.

The browser communicates with your FastAPI backend. The backend communicates with OpenRouter.

## Architecture

```text
Browser
   │
   ▼
My AI v5 Frontend
   │
   ▼
FastAPI Backend
   ├── SQLite conversations
   └── OpenRouter API
            │
            ▼
         AI Model
```

## Project structure

```text
my_ai_assistant_v5/
├── main.py
├── index.html
├── requirements.txt
├── .env.example
├── .gitignore
├── README.md
└── static/
    ├── script.js
    └── style.css
```

The SQLite database `my_ai.db` is created automatically when the server starts.
