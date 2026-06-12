const chatBox = document.getElementById("chatBox");
const messageInput = document.getElementById("message");

const SESSION_ID = Math.random().toString(36).slice(2);

function getTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Convert plain text bot reply into safe HTML with clickable links
function formatBotReply(text) {
  // Escape HTML first
  let safe = escapeHtml(text);
  // Convert URLs into anchor tags
  safe = safe.replace(
    /(https?:\/\/[^\s<>"]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  // Convert newlines to <br>
  safe = safe.replace(/\n/g, "<br>");
  return safe;
}

function appendUserMessage(text) {
  const group = document.createElement("div");
  group.className = "message-group user-group";
  group.innerHTML = `
    <div class="messages">
      <div class="bubble user-bubble">${escapeHtml(text)}</div>
      <span class="timestamp">${getTime()}</span>
    </div>
  `;
  chatBox.appendChild(group);
  scrollBottom();
}

function appendBotMessage(rawText, isError = false) {
  const group = document.createElement("div");
  group.className = "message-group bot-group";
  group.innerHTML = `
    <div class="msg-avatar">S</div>
    <div class="messages">
      <div class="bubble bot-bubble${isError ? " error-bubble" : ""}">${formatBotReply(rawText)}</div>
      <span class="timestamp">${getTime()}</span>
    </div>
  `;
  chatBox.appendChild(group);
  scrollBottom();
}

function showTyping() {
  const el = document.createElement("div");
  el.className = "typing-wrap";
  el.id = "typing";
  el.innerHTML = `
    <div class="msg-avatar">S</div>
    <div class="typing-bubble">
      <span></span><span></span><span></span>
    </div>
    <span class="searching-label" id="searchingLabel">Searching stores…</span>
  `;
  chatBox.appendChild(el);
  scrollBottom();
}

function removeTyping() {
  const el = document.getElementById("typing");
  if (el) el.remove();
}

function scrollBottom() {
  chatBox.scrollTop = chatBox.scrollHeight;
}

function hideChips() {
  const chips = document.getElementById("chipRow");
  if (chips) chips.style.display = "none";
}

function setSending(isSending) {
  const btn = document.getElementById("sendBtn");
  btn.disabled = isSending;
  btn.style.opacity = isSending ? "0.5" : "1";
  messageInput.disabled = isSending;
}

async function sendMessage(overrideText) {
  const text = (overrideText || messageInput.value).trim();
  if (!text) return;

  hideChips();
  appendUserMessage(text);
  messageInput.value = "";
  setSending(true);
  showTyping();

  try {
    const response = await fetch("http://localhost:5000/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text, sessionId: SESSION_ID }),
    });

    const data = await response.json();
    removeTyping();

    if (!response.ok) {
      appendBotMessage(data.reply || "Something went wrong. Please try again.", true);
    } else {
      appendBotMessage(data.reply);
    }

  } catch (err) {
    removeTyping();
    appendBotMessage(
      "I'm having trouble connecting right now. Please check your connection and try again.",
      true
    );
  } finally {
    setSending(false);
    messageInput.focus();
  }
}

messageInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.querySelectorAll(".topic-btn").forEach((btn) => {
  btn.addEventListener("click", () => sendMessage(btn.dataset.msg));
});

document.querySelectorAll(".chip").forEach((chip) => {
  chip.addEventListener("click", () => sendMessage(chip.dataset.msg));
});

document.getElementById("clearBtn").addEventListener("click", () => {
  chatBox.innerHTML = `
    <div class="message-group bot-group">
      <div class="msg-avatar">S</div>
      <div class="messages">
        <div class="bubble bot-bubble">Chat cleared! 👋 What are you looking to shop for today?</div>
        <span class="timestamp">${getTime()}</span>
      </div>
    </div>
  `;
});