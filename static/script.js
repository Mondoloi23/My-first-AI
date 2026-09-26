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
    html = html.replace(
        /(<li>.*?<\/li>)/gs,
        "<ul>$1</ul>"
    );

    return html.replace(/\n/g, "<br>");
}

async function api(url, options = {}) {
    const response = await fetch(url, options);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Request failed: ${response.status}`);
    }

    return response;
}

function renderChatList() {
    const chatList = $("#chatList");

    if (!chatList) return;

    chatList.innerHTML = chats.map(chat => `
        <div class="chat-item ${chat.id === currentChatId ? "active" : ""}"
             data-id="${chat.id}">

            <span>${escapeHtml(chat.title || "New chat")}</span>

            <button
                class="delete-chat"
                data-delete="${chat.id}"
                aria-label="Delete chat">
                ×
            </button>
        </div>
    `).join("");

    document.querySelectorAll(".chat-item").forEach(item => {
        item.addEventListener("click", (event) => {
            if (event.target.closest(".delete-chat")) return;

            selectChat(item.dataset.id);
        });
    });

    document.querySelectorAll(".delete-chat").forEach(button => {
        button.addEventListener("click", async (event) => {
            event.stopPropagation();

            const id = button.dataset.delete;

            try {
                await api(`/api/chats/${id}`, {
                    method: "DELETE"
                });

                if (id === currentChatId) {
                    currentChatId = null;
                }

                await loadChats();

            } catch (error) {
                console.error("Delete chat error:", error);
                alert("Could not delete this chat.");
            }
        });
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
                    ? renderMarkdown(message.content || "")
                    : escapeHtml(message.content || "")
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

    $("#chatTitle").textContent = chat.title || "New chat";

    renderChatList();
    renderMessages([]);

    return chat;
}

async function selectChat(id) {
    currentChatId = id;

    const chat = chats.find(item => item.id === id);

    $("#chatTitle").textContent =
        chat?.title || "New chat";

    try {
        const response = await api(
            `/api/chats/${id}/messages`
        );

        const messages = await response.json();

        renderMessages(messages);
        renderChatList();

    } catch (error) {
        console.error("Load messages error:", error);
    }
}

async function loadChats() {
    try {
        const response = await api("/api/chats");

        chats = await response.json();

        renderChatList();

        if (chats.length > 0) {
            await selectChat(chats[0].id);
        } else {
            await createChat();
        }

    } catch (error) {
        console.error("Load chats error:", error);

        messagesEl.innerHTML = `
            <div class="welcome">
                <h1>My AI</h1>
                <p>Could not connect to the server.</p>
                <p>Please refresh the page.</p>
            </div>
        `;
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

    scrollToBottom();

    try {
        // Save user's message
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

        // Create empty assistant message
        const assistantMessage = addMessage({
            role: "assistant",
            content: ""
        });

        const bubble =
            assistantMessage.querySelector(".bubble");

        let fullResponse = "";

        const model =
            localStorage.getItem("myai_model")
            || "openrouter/free";

        const temperature =
            Number(
                localStorage.getItem("myai_temperature")
                || "0.7"
            );

        // Start streaming
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

        if (!response.body) {
            throw new Error("Streaming is not supported by this browser.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";

        while (true) {
            const { value, done } =
                await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, {
                stream: true
            });

            const lines = buffer.split("\n");

            buffer = lines.pop() || "";

            for (const line of lines) {

                if (!line.startsWith("data: ")) {
                    continue;
                }

                const rawData = line.slice(6).trim();

                if (!rawData) {
                    continue;
                }

                try {
                    const data = JSON.parse(rawData);

                    // Server-side error
                    if (data.error) {
                        throw new Error(data.error);
                    }

                    // Normal token
                    if (data.content) {
                        fullResponse += data.content;

                        bubble.innerHTML =
                            renderMarkdown(fullResponse);

                        scrollToBottom();
                    }

                    // Stream finished
                    if (data.done) {
                        break;
                    }

                } catch (parseError) {
                    console.warn(
                        "Could not parse stream data:",
                        rawData
                    );
                }
            }
        }

        // Update sidebar after first message
        await loadChats();

    } catch (error) {
        console.error("Send message error:", error);

        const errorMessage = addMessage({
            role: "assistant",
            content:
                "Sorry, I couldn't connect to the AI server. Please try again."
        });

        console.error(errorMessage);

    } finally {
        busy = false;
        inputEl.focus();
    }
}

// Send button
const sendButton = $("#send");

if (sendButton) {
    sendButton.addEventListener("click", () => {
        sendMessage(inputEl.value);
    });
}

// Enter key
inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();

        sendMessage(inputEl.value);
    }
});

// Auto resize textarea
inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height =
        Math.min(inputEl.scrollHeight, 180) + "px";
});

// New chat
$("#newChat")?.addEventListener("click", async () => {
    if (busy) return;

    await createChat();
});

// Clear/delete current chat
$("#clearChat")?.addEventListener("click", async () => {
    if (!currentChatId || busy) return;

    const confirmed =
        confirm("Delete this conversation?");

    if (!confirmed) return;

    try {
        await api(
            `/api/chats/${currentChatId}`,
            {
                method: "DELETE"
            }
        );

        currentChatId = null;

        await loadChats();

    } catch (error) {
        console.error("Clear chat error:", error);
    }
});

// Prompt buttons
document.querySelectorAll("[data-prompt]").forEach(button => {
    button.addEventListener("click", () => {
        const prompt = button.dataset.prompt;

        if (prompt) {
            inputEl.value = prompt;
            inputEl.focus();
        }
    });
});

// Copy code buttons
messagesEl.addEventListener("click", async (event) => {
    const button =
        event.target.closest(".copy-code");

    if (!button) return;

    const code =
        decodeURIComponent(button.dataset.code);

    try {
        await navigator.clipboard.writeText(code);

        button.textContent = "Copied!";

        setTimeout(() => {
            button.textContent = "Copy";
        }, 1500);

    } catch (error) {
        console.error("Copy failed:", error);
    }
});

// Settings
const settingsDialog = $("#settingsDialog");

$("#settingsBtn")?.addEventListener("click", () => {
    const modelInput = $("#modelInput");
    const temperatureInput = $("#temperatureInput");

    modelInput.value =
        localStorage.getItem("myai_model")
        || "openrouter/free";

    temperatureInput.value =
        localStorage.getItem("myai_temperature")
        || "0.7";

    settingsDialog?.showModal();
});

$("#saveSettings")?.addEventListener("click", () => {
    const model =
        $("#modelInput").value.trim()
        || "openrouter/free";

    const temperature =
        Number($("#temperatureInput").value)
        || 0.7;

    localStorage.setItem(
        "myai_model",
        model
    );

    localStorage.setItem(
        "myai_temperature",
        temperature
    );

    settingsDialog?.close();
});

// Mobile menu
$("#menuBtn")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
});

// Close sidebar when clicking outside
document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("sidebar-open")) {
        return;
    }

    const sidebar =
        document.querySelector(".sidebar");

    const menuButton =
        $("#menuBtn");

    if (
        sidebar &&
        !sidebar.contains(event.target) &&
        !menuButton?.contains(event.target)
    ) {
        document.body.classList.remove(
            "sidebar-open"
        );
    }
});

// Voice input
const voiceButton = $("#voiceBtn");

if (
    voiceButton &&
    ("SpeechRecognition" in window ||
        "webkitSpeechRecognition" in window)
) {
    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    const recognition =
        new SpeechRecognition();

    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    voiceButton.addEventListener("click", () => {
        try {
            recognition.start();
            voiceButton.classList.add("recording");
        } catch (error) {
            console.warn(
                "Voice recognition could not start:",
                error
            );
        }
    });

    recognition.onresult = (event) => {
        const transcript =
            event.results[0][0].transcript;

        inputEl.value =
            `${inputEl.value} ${transcript}`.trim();

        inputEl.dispatchEvent(
            new Event("input")
        );

        inputEl.focus();
    };

    recognition.onend = () => {
        voiceButton.classList.remove("recording");
    };

    recognition.onerror = () => {
        voiceButton.classList.remove("recording");
    };

} else if (voiceButton) {
    voiceButton.style.display = "none";
}

// Start application
loadChats();const $ = (selector) => document.querySelector(selector);

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
    html = html.replace(
        /(<li>.*?<\/li>)/gs,
        "<ul>$1</ul>"
    );

    return html.replace(/\n/g, "<br>");
}

async function api(url, options = {}) {
    const response = await fetch(url, options);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(errorText || `Request failed: ${response.status}`);
    }

    return response;
}

function renderChatList() {
    const chatList = $("#chatList");

    if (!chatList) return;

    chatList.innerHTML = chats.map(chat => `
        <div class="chat-item ${chat.id === currentChatId ? "active" : ""}"
             data-id="${chat.id}">

            <span>${escapeHtml(chat.title || "New chat")}</span>

            <button
                class="delete-chat"
                data-delete="${chat.id}"
                aria-label="Delete chat">
                ×
            </button>
        </div>
    `).join("");

    document.querySelectorAll(".chat-item").forEach(item => {
        item.addEventListener("click", (event) => {
            if (event.target.closest(".delete-chat")) return;

            selectChat(item.dataset.id);
        });
    });

    document.querySelectorAll(".delete-chat").forEach(button => {
        button.addEventListener("click", async (event) => {
            event.stopPropagation();

            const id = button.dataset.delete;

            try {
                await api(`/api/chats/${id}`, {
                    method: "DELETE"
                });

                if (id === currentChatId) {
                    currentChatId = null;
                }

                await loadChats();

            } catch (error) {
                console.error("Delete chat error:", error);
                alert("Could not delete this chat.");
            }
        });
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
                    ? renderMarkdown(message.content || "")
                    : escapeHtml(message.content || "")
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

    $("#chatTitle").textContent = chat.title || "New chat";

    renderChatList();
    renderMessages([]);

    return chat;
}

async function selectChat(id) {
    currentChatId = id;

    const chat = chats.find(item => item.id === id);

    $("#chatTitle").textContent =
        chat?.title || "New chat";

    try {
        const response = await api(
            `/api/chats/${id}/messages`
        );

        const messages = await response.json();

        renderMessages(messages);
        renderChatList();

    } catch (error) {
        console.error("Load messages error:", error);
    }
}

async function loadChats() {
    try {
        const response = await api("/api/chats");

        chats = await response.json();

        renderChatList();

        if (chats.length > 0) {
            await selectChat(chats[0].id);
        } else {
            await createChat();
        }

    } catch (error) {
        console.error("Load chats error:", error);

        messagesEl.innerHTML = `
            <div class="welcome">
                <h1>My AI</h1>
                <p>Could not connect to the server.</p>
                <p>Please refresh the page.</p>
            </div>
        `;
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

    scrollToBottom();

    try {
        // Save user's message
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

        // Create empty assistant message
        const assistantMessage = addMessage({
            role: "assistant",
            content: ""
        });

        const bubble =
            assistantMessage.querySelector(".bubble");

        let fullResponse = "";

        const model =
            localStorage.getItem("myai_model")
            || "openrouter/free";

        const temperature =
            Number(
                localStorage.getItem("myai_temperature")
                || "0.7"
            );

        // Start streaming
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

        if (!response.body) {
            throw new Error("Streaming is not supported by this browser.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let buffer = "";

        while (true) {
            const { value, done } =
                await reader.read();

            if (done) {
                break;
            }

            buffer += decoder.decode(value, {
                stream: true
            });

            const lines = buffer.split("\n");

            buffer = lines.pop() || "";

            for (const line of lines) {

                if (!line.startsWith("data: ")) {
                    continue;
                }

                const rawData = line.slice(6).trim();

                if (!rawData) {
                    continue;
                }

                try {
                    const data = JSON.parse(rawData);

                    // Server-side error
                    if (data.error) {
                        throw new Error(data.error);
                    }

                    // Normal token
                    if (data.content) {
                        fullResponse += data.content;

                        bubble.innerHTML =
                            renderMarkdown(fullResponse);

                        scrollToBottom();
                    }

                    // Stream finished
                    if (data.done) {
                        break;
                    }

                } catch (parseError) {
                    console.warn(
                        "Could not parse stream data:",
                        rawData
                    );
                }
            }
        }

        // Update sidebar after first message
        await loadChats();

    } catch (error) {
        console.error("Send message error:", error);

        const errorMessage = addMessage({
            role: "assistant",
            content:
                "Sorry, I couldn't connect to the AI server. Please try again."
        });

        console.error(errorMessage);

    } finally {
        busy = false;
        inputEl.focus();
    }
}

// Send button
const sendButton = $("#send");

if (sendButton) {
    sendButton.addEventListener("click", () => {
        sendMessage(inputEl.value);
    });
}

// Enter key
inputEl.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();

        sendMessage(inputEl.value);
    }
});

// Auto resize textarea
inputEl.addEventListener("input", () => {
    inputEl.style.height = "auto";
    inputEl.style.height =
        Math.min(inputEl.scrollHeight, 180) + "px";
});

// New chat
$("#newChat")?.addEventListener("click", async () => {
    if (busy) return;

    await createChat();
});

// Clear/delete current chat
$("#clearChat")?.addEventListener("click", async () => {
    if (!currentChatId || busy) return;

    const confirmed =
        confirm("Delete this conversation?");

    if (!confirmed) return;

    try {
        await api(
            `/api/chats/${currentChatId}`,
            {
                method: "DELETE"
            }
        );

        currentChatId = null;

        await loadChats();

    } catch (error) {
        console.error("Clear chat error:", error);
    }
});

// Prompt buttons
document.querySelectorAll("[data-prompt]").forEach(button => {
    button.addEventListener("click", () => {
        const prompt = button.dataset.prompt;

        if (prompt) {
            inputEl.value = prompt;
            inputEl.focus();
        }
    });
});

// Copy code buttons
messagesEl.addEventListener("click", async (event) => {
    const button =
        event.target.closest(".copy-code");

    if (!button) return;

    const code =
        decodeURIComponent(button.dataset.code);

    try {
        await navigator.clipboard.writeText(code);

        button.textContent = "Copied!";

        setTimeout(() => {
            button.textContent = "Copy";
        }, 1500);

    } catch (error) {
        console.error("Copy failed:", error);
    }
});

// Settings
const settingsDialog = $("#settingsDialog");

$("#settingsBtn")?.addEventListener("click", () => {
    const modelInput = $("#modelInput");
    const temperatureInput = $("#temperatureInput");

    modelInput.value =
        localStorage.getItem("myai_model")
        || "openrouter/free";

    temperatureInput.value =
        localStorage.getItem("myai_temperature")
        || "0.7";

    settingsDialog?.showModal();
});

$("#saveSettings")?.addEventListener("click", () => {
    const model =
        $("#modelInput").value.trim()
        || "openrouter/free";

    const temperature =
        Number($("#temperatureInput").value)
        || 0.7;

    localStorage.setItem(
        "myai_model",
        model
    );

    localStorage.setItem(
        "myai_temperature",
        temperature
    );

    settingsDialog?.close();
});

// Mobile menu
$("#menuBtn")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
});

// Close sidebar when clicking outside
document.addEventListener("click", (event) => {
    if (!document.body.classList.contains("sidebar-open")) {
        return;
    }

    const sidebar =
        document.querySelector(".sidebar");

    const menuButton =
        $("#menuBtn");

    if (
        sidebar &&
        !sidebar.contains(event.target) &&
        !menuButton?.contains(event.target)
    ) {
        document.body.classList.remove(
            "sidebar-open"
        );
    }
});

// Voice input
const voiceButton = $("#voiceBtn");

if (
    voiceButton &&
    ("SpeechRecognition" in window ||
        "webkitSpeechRecognition" in window)
) {
    const SpeechRecognition =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;

    const recognition =
        new SpeechRecognition();

    recognition.lang = "en-US";
    recognition.interimResults = false;
    recognition.continuous = false;

    voiceButton.addEventListener("click", () => {
        try {
            recognition.start();
            voiceButton.classList.add("recording");
        } catch (error) {
            console.warn(
                "Voice recognition could not start:",
                error
            );
        }
    });

    recognition.onresult = (event) => {
        const transcript =
            event.results[0][0].transcript;

        inputEl.value =
            `${inputEl.value} ${transcript}`.trim();

        inputEl.dispatchEvent(
            new Event("input")
        );

        inputEl.focus();
    };

    recognition.onend = () => {
        voiceButton.classList.remove("recording");
    };

    recognition.onerror = () => {
        voiceButton.classList.remove("recording");
    };

} else if (voiceButton) {
    voiceButton.style.display = "none";
}

// Start application
loadChats();
