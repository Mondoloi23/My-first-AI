const $ = (selector) => document.querySelector(selector);

let chats = [];
let currentChatId = null;
let busy = false;

const messagesEl = $("#messages");
const inputEl = $("#input");

function escapeHtml(text) {
    return String(text).replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    }[char]));
}

function renderMarkdown(text) {
    let html = escapeHtml(text);

    html = html.replace(
        /```([\s\S]*?)```/g,
        (_, code) =>
            `<pre><button class="copy-code" data-code="${encodeURIComponent(code.trim())}">Copy</button><code>${code.trim()}</code></pre>`
    );

    html = html.replace(/^### (.*)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.*)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.*)$/gm, "<h1>$1</h1>");
    html = html.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    html = html.replace(/^\s*[-*] (.*)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>)/gs, "<ul>$1</ul>");

    return html.replace(/\n/g, "<br>");
}

async function api(url, options = {}) {
    const response = await fetch(url, options);

    if (!response.ok) {
        throw new Error(await response.text());
    }

    return response;
}

function renderChatList() {
    $("#chatList").innerHTML = chats.map(chat => `
        <div class="chat-item ${chat.id === currentChatId ? "active" : ""}"
             data-id="${chat.id}">
            <span>${escapeHtml(chat.title)}</span>
            <button class="delete-chat"
                    data-delete="${chat.id}">
                ×
            </button>
        </div>
    `).join("");

    document.querySelectorAll(".chat-item").forEach(item => {
        item.onclick = (event) => {
            if (!event.target.dataset.delete) {
                selectChat(item.dataset.id);
            }
        };
    });

    document.querySelectorAll(".delete-chat").forEach(button => {
        button.onclick = async (event) => {
            event.stopPropagation();

            const id = button.dataset.delete;

            await api(`/api/chats/${id}`, {
                method: "DELETE"
            });

            if (id === currentChatId) {
                currentChatId = null;
            }

            await loadChats();
        };
    });
}

function renderMessages(list) {
    messagesEl.innerHTML = "";

    if (!list.length) {
        messagesEl.innerHTML = `
            <div class="welcome">
                <h1>How can I help?</h1>
                <p>Your personal AI assistant.</p>
            </div>
        `;
        return;
    }

    list.forEach(addMessage);

    scrollToBottom();
}

function addMessage(message) {
    document.querySelector(".welcome")?.remove();

    const element = document.createElement("div");

    element.className = `message ${message.role}`;

    element.innerHTML = `
        <div class="bubble">
            ${
                message.role === "assistant"
                    ? renderMarkdown(message.content)
                    : escapeHtml(message.content)
            }
        </div>
    `;

    messagesEl.appendChild(element);

    return element;
}

function scrollToBottom() {
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function createChat() {
    const response = await api("/api/chats", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            title: "New chat"
        })
    });

    const chat = await response.json();

    chats.unshift(chat);

    currentChatId = chat.id;

    $("#chatTitle").textContent = chat.title;

    renderChatList();
    renderMessages([]);

    return chat;
}

async function selectChat(id) {
    currentChatId = id;

    const chat = chats.find(item => item.id === id);

    $("#chatTitle").textContent =
        chat?.title || "New chat";

    const response = await api(
        `/api/chats/${id}/messages`
    );

    const messages = await response.json();

    renderMessages(messages);

    renderChatList();
}

async function loadChats() {
    const response = await api("/api/chats");

    chats = await response.json();

    renderChatList();

    if (chats.length > 0) {
        await selectChat(chats[0].id);
    } else {
        await createChat();
    }
}

async function sendMessage(text) {
    if (busy || !text.trim()) {
        return;
    }

    if (!currentChatId) {
        await createChat();
    }

    busy = true;

    inputEl.value = "";
    inputEl.style.height = "auto";

    addMessage({
        role: "user",
        content: text
    });

    await api(
        `/api/chats/${currentChatId}/messages`,
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                content: text
            })
        }
    );

    const assistantMessage = addMessage({
        role: "assistant",
        content: ""
    });

    const bubble =
        assistantMessage.querySelector(".bubble");

    let fullResponse = "";

    try {
        const model =
            localStorage.getItem("myai_model")
            || "openrouter/free";

        const temperature =
            Number(
                localStorage.getItem("myai_temperature")
                || "0.7"
            );

        const response = await fetch(
            `/api/chats/${currentChatId}/stream`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    model,
                    temperature
                })
            }
        );

        if (!response.ok) {
            throw new Error(await response.text());
        }

        const reader =
            response.body.getReader();

        const decoder = new TextDecoder();

        while (true) {
            const { value, done } =
                await reader.read();

            if (done) {
                break;
            }

            const chunk =
                decoder.decode(value, {
                    stream: true
                });

            const lines = chunk.split("\n");

            for (const line of lines) {

                if (!line.startsWith("data: ")) {
                    continue;
                }

                const data =
                    JSON.parse(line.slice(6));

               
