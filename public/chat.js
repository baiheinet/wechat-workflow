(function () {
  'use strict';
  const $ = window.WW.$;
  const api = window.WW.api;

  let state = null;
  let currentSlug = null;
  let streaming = false;

  function init(appState) {
    state = appState;
    bind();
    loadHistory();
  }

  function loadHistory() {
    const key = 'ww.chat.' + (state.activeSlug || 'default');
    let msgs = [];
    try {
      const raw = localStorage.getItem(key);
      if (raw) msgs = JSON.parse(raw) || [];
    } catch (e) { msgs = []; }
    state.chatMessages = Array.isArray(msgs) ? msgs : [];
    renderMessages();

    // Update input placeholder with commands
    const input = $('#chat-input');
    if (input) input.placeholder = '输入消息... /image /polish /research';
  }

  function saveHistory() {
    const key = 'ww.chat.' + (state.activeSlug || 'default');
    try { localStorage.setItem(key, JSON.stringify(state.chatMessages.slice(-100))); }
    catch (e) { /* quota exceeded */ }
  }

  function renderMessages() {
    const el = $('#chat-messages');
    if (!el) return;
    const msgs = state.chatMessages || [];
    if (msgs.length === 0) {
      el.innerHTML = '<div class="chat-empty"><div class="chat-empty-icon">💬</div><div class="chat-empty-text">AI 写作助手</div><div class="chat-empty-hint">输入 /image 生成图片<br>/polish 润色文字<br>/research 研究主题</div></div>';
      return;
    }
    el.innerHTML = msgs.map(m => {
      const cls = m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-assistant';
      const content = esc(m.content).replace(/\n/g, '<br>');
      return `<div class="chat-bubble ${cls}">${content}</div>`;
    }).join('');
    el.scrollTop = el.scrollHeight;
  }

  function appendMessage(role, content) {
    if (!state.chatMessages) state.chatMessages = [];
    state.chatMessages.push({ role, content });
    renderMessages();
    saveHistory();
  }

  function updateLastMessage(content) {
    const msgs = state.chatMessages;
    if (msgs.length > 0) {
      const last = msgs[msgs.length - 1];
      last.content += content;
      renderMessages();
    }
  }

  function bind() {
    const input = $('#chat-input');
    const sendBtn = $('#chat-send');
    const toggleBtn = $('#chat-toggle');
    const panel = $('#ai-panel');

    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage();
        }
      });
    }
    if (sendBtn) sendBtn.addEventListener('click', sendMessage);
    if (toggleBtn && panel) {
      toggleBtn.addEventListener('click', () => {
        const collapsed = panel.classList.toggle('collapsed');
        toggleBtn.textContent = collapsed ? '💬' : '✕';
      });
    }
  }

  async function sendMessage() {
    const input = $('#chat-input');
    if (!input) return;
    const text = input.value.trim();
    if (!text) return;
    if (streaming) return;

    // Handle slash commands
    if (text.startsWith('/image ')) {
      input.value = '';
      const prompt = text.slice(7).trim();
      await handleImageCommand(prompt);
      return;
    }
    if (text === '/polish' || text.startsWith('/polish ')) {
      input.value = '';
      const extra = text.startsWith('/polish ') ? text.slice(8).trim() : '';
      await handlePolishCommand(extra);
      return;
    }
    if (text.startsWith('/research ')) {
      input.value = '';
      const topic = text.slice(10).trim();
      await handleResearchCommand(topic);
      return;
    }

    input.value = '';
    appendMessage('user', text);
    await streamChat(text);
  }

  async function streamChat(content) {
    const msgs = state.chatMessages || [];
    const history = msgs.slice(-20).map(m => ({ role: m.role, content: m.content }));

    appendMessage('assistant', '');
    streaming = true;

    const { xhr } = api.chatStream(history, 'chat');
    let accumulated = '';

    const cancel = api.chatStreamOnData(xhr,
      (delta) => {
        accumulated += delta;
        updateLastMessage(delta);
      },
      () => {
        streaming = false;
        saveHistory();
      },
      (err) => {
        streaming = false;
        updateLastMessage('\n\n[错误: ' + err + ']');
        saveHistory();
      }
    );

    state._chatCancel = cancel;
    state._chatXHR = xhr;
  }

  async function handleImageCommand(prompt) {
    appendMessage('user', '/image ' + prompt);
    appendMessage('assistant', '生成图片中...');
    streaming = true;
    try {
      const result = await api.generateImage({ type: 'inline', description: prompt, title: prompt });
      if (result && result.url) {
        const msgs = state.chatMessages;
        if (msgs.length > 0) msgs[msgs.length - 1].content = '';
        const imgHtml = `<figure class="chat-image"><img src="${result.url}" alt="${esc(prompt)}"></figure>`;
        if (msgs.length > 0) msgs[msgs.length - 1].content = imgHtml;
        renderMessages();
        saveHistory();

        // Also insert into editor
        if (window.WW.editor) window.WW.editor.insertImage(result.url);
      }
    } catch (err) {
      updateLastMessage('\n\n生成失败: ' + err.message);
    }
    streaming = false;
    saveHistory();
  }

  async function handlePolishCommand(extraText) {
    let text = '';
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) text = sel.toString().trim();
    if (!text) text = extraText;
    if (!text) {
      appendMessage('user', '/polish');
      appendMessage('assistant', '请先在编辑器选中要润色的文字，或在命令后附上文字。');
      return;
    }

    appendMessage('user', '/polish: ' + text.slice(0, 80) + (text.length > 80 ? '...' : ''));
    appendMessage('assistant', '');
    streaming = true;

    try {
      const result = await api.chatPolish(text);
      if (result && result.result) {
        const msgs = state.chatMessages;
        if (msgs.length > 0) msgs[msgs.length - 1].content = result.result;
        renderMessages();
        saveHistory();
        // Replace editor selection with polished text
        if (sel && !sel.isCollapsed) {
          document.execCommand('insertText', false, result.result);
          if (window.WW.editor) window.WW.editor.markDirty();
        }
      }
    } catch (err) {
      updateLastMessage('\n\n润色失败: ' + err.message);
    }
    streaming = false;
    saveHistory();
  }

  async function handleResearchCommand(topic) {
    appendMessage('user', '/research ' + topic);
    appendMessage('assistant', '');
    streaming = true;

    try {
      const result = await api.chatResearch(topic);
      if (result && result.result) {
        const msgs = state.chatMessages;
        if (msgs.length > 0) msgs[msgs.length - 1].content = result.result;
        renderMessages();
        saveHistory();
      }
    } catch (err) {
      updateLastMessage('\n\n研究失败: ' + err.message);
    }
    streaming = false;
    saveHistory();
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  window.WW = window.WW || {};
  window.WW.chat = { init, loadHistory, appendMessage, sendMessage };
})();
