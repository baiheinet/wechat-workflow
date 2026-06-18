(function () {
  'use strict';
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const api = {
    async _fetch(path, opts) {
      opts = opts || {};
      const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        ...opts
      });
      const ct = res.headers.get('content-type') || '';
      const isJson = ct.includes('application/json');
      const body = isJson ? await res.json() : await res.text();
      if (!res.ok) {
        const err = new Error((isJson && body && body.error) || `HTTP ${res.status}`);
        err.status = res.status;
        err.body = body;
        throw err;
      }
      return body;
    },
    health() { return this._fetch('/api/health'); },
    listArticles() { return this._fetch('/api/articles'); },
    getArticle(slug) { return this._fetch(`/api/articles/${encodeURIComponent(slug)}`); },
    createArticle(payload) { return this._fetch('/api/articles', { method: 'POST', body: JSON.stringify(payload) }); },
    updateArticle(slug, payload) { return this._fetch(`/api/articles/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(payload) }); },
    deleteArticle(slug) { return this._fetch(`/api/articles/${encodeURIComponent(slug)}`, { method: 'DELETE' }); },
    listTopics() { return this._fetch('/api/topics'); },
    getTopic(slug) { return this._fetch(`/api/topics/${encodeURIComponent(slug)}`); },
    createTopic(payload) { return this._fetch('/api/topics', { method: 'POST', body: JSON.stringify(payload) }); },
    updateTopic(slug, payload) { return this._fetch(`/api/topics/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(payload) }); },
    deleteTopic(slug) { return this._fetch(`/api/topics/${encodeURIComponent(slug)}`, { method: 'DELETE' }); },
    listTemplates() { return this._fetch('/api/templates'); },
    render(payload) { return this._fetch('/api/render', { method: 'POST', body: JSON.stringify(payload) }); },
    generateImage(payload) { return this._fetch('/api/generate-image', { method: 'POST', body: JSON.stringify(payload) }); },
    publish(payload) { return this._fetch('/api/publish', { method: 'POST', body: JSON.stringify(payload) }); },
    convert(payload) { return this._fetch('/api/convert', { method: 'POST', body: JSON.stringify(payload) }); },
    chatStream(messages, skill) {
      const baseUrl = location.origin;
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${baseUrl}/api/chat/stream`, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      let aborted = false;
      const cancel = () => { aborted = true; xhr.abort(); };
      const promise = new Promise((resolve, reject) => {
        xhr.onreadystatechange = () => {
          if (aborted) return;
          if (xhr.readyState === 3 || xhr.readyState === 4) {
            const text = xhr.responseText;
            if (!text) return;
            const chunks = text.split('\n');
            const lastData = chunks.filter(c => c.startsWith('data: ')).pop();
            if (lastData && lastData.includes('[DONE]')) resolve();
            if (xhr.readyState === 4 && !text.includes('[DONE]')) resolve();
          }
        };
        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(JSON.stringify({ messages, skill }));
      });
      return { xhr, cancel, promise };
    },
    chatStreamOnData(xhr, onData, onDone, onError) {
      let lastIndex = 0;
      const check = () => {
        if (xhr.readyState < 3) return;
        const text = xhr.responseText;
        const newText = text.slice(lastIndex);
        lastIndex = text.length;
        const lines = newText.split('\n');
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') { if (onDone) onDone(); return; }
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) { if (onError) onError(parsed.error); return; }
            if (parsed.content && onData) onData(parsed.content);
          } catch (e) { /* skip */ }
        }
        if (xhr.readyState === 4 && onDone) onDone();
      };
      xhr.addEventListener('readystatechange', check);
      const cancel = () => { xhr.abort(); };
      return cancel;
    },
    async chatPolish(text) {
      return this._fetch('/api/chat/skills/polish', { method: 'POST', body: JSON.stringify({ text }) });
    },
    async chatResearch(topic) {
      return this._fetch('/api/chat/skills/research', { method: 'POST', body: JSON.stringify({ topic }) });
    }
  };

  window.WW = window.WW || {};
  window.WW.api = api;
  window.WW.$ = $;
  window.WW.$$ = $$;
})();
