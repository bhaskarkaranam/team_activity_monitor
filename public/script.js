const messages = document.getElementById('messages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');

function addMessage(text, role) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'message bot typing';
  div.id = 'typing-indicator';
  div.innerHTML = '<span></span><span></span><span></span>';
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
}

function hideTyping() {
  document.getElementById('typing-indicator')?.remove();
}

function setInputEnabled(enabled) {
  userInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
}

async function sendMessage() {
  const text = userInput.value.trim();
  if (!text) return;

  userInput.value = '';
  setInputEnabled(false);
  addMessage(text, 'user');
  showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });

    // Pre-SSE errors (400, 404, etc.) come back as JSON
    if (!res.ok) {
      const err = await res.json();
      hideTyping();
      addMessage(err.error || 'Something went wrong. Please try again.', 'error');
      setInputEnabled(true);
      return;
    }

    // SSE stream: build the bot bubble incrementally
    hideTyping();
    const botBubble = addMessage('', 'bot');
    let fullText = '';

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop(); // keep incomplete last line

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const event = JSON.parse(line.slice(6));

        if (event.type === 'delta') {
          fullText += event.text;
          botBubble.textContent = fullText;
          messages.scrollTop = messages.scrollHeight;
        } else if (event.type === 'done') {
          const sourceLabels = [
            event.sources?.jira && 'JIRA',
            event.sources?.github && 'GitHub',
          ].filter(Boolean);
          if (sourceLabels.length) {
            const sourceEl = document.createElement('div');
            sourceEl.className = 'sources';
            sourceEl.textContent = `Sources: ${sourceLabels.join(' · ')}`;
            botBubble.appendChild(sourceEl);
          }
        } else if (event.type === 'error') {
          botBubble.textContent = event.message || 'Something went wrong. Please try again.';
          botBubble.classList.add('error');
        }
      }
    }
  } catch (err) {
    hideTyping();
    addMessage('Connection error. Please check your network and try again.', 'error');
  } finally {
    setInputEnabled(true);
    userInput.focus();
  }
}

sendBtn.addEventListener('click', sendMessage);
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

// Welcome message
addMessage('Hi! Ask me what any team member is working on.\nTry: "What is Alice working on these days?"', 'bot');
userInput.focus();
