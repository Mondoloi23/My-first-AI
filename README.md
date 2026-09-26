# My AI Assistant v3

Features:
- ChatGPT-style responsive UI
- Persistent chat history in browser localStorage
- Conversation context sent to backend
- Streaming AI responses
- Voice input when supported by browser
- Secure API key kept in backend environment

## Run

```bash
python -m venv .venv
```

Activate the environment, then:

```bash
pip install -r requirements.txt
```

Create `.env`:

```env
OPENAI_API_KEY=your_real_api_key_here
```

Start:

```bash
uvicorn main:app --reload
```

Then open `index.html`.

Never put your API key in JavaScript or commit `.env` to Git.
