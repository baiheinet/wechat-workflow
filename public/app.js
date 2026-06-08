(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    articles: [],
    articlesBySlug: new Map(),
    activeSlug: null,
    activeArticle: null,
    filter: 'all',
    search: '',
    template: 'minimal',
    templates: [],
    config: null,
    summary: null,
    dirty: false,
    saveTimer: null,
    renderTimer: null,
    saveInFlight: false,
    lastSavedAt: null,
    promptPresets: {},
    promptPresetCatalog: null
  };

  const PROMPT_PRESETS_KEY = 'wechatwf.promptPresets.v1';

  function loadPromptPresets() {
    try {
      const raw = localStorage.getItem(PROMPT_PRESETS_KEY);
      if (raw) state.promptPresets = JSON.parse(raw) || {};
    } catch (err) {
      state.promptPresets = {};
    }
  }

  function savePromptPresets() {
    try { localStorage.setItem(PROMPT_PRESETS_KEY, JSON.stringify(state.promptPresets)); }
    catch (err) { console.warn('persist promptPresets failed', err); }
  }

  function getPromptPresetFor(slug) {
    if (!slug) return null;
    return state.promptPresets[slug] || null;
  }

  function setPromptPresetFor(slug, opts) {
    if (!slug) return;
    if (opts && Object.values(opts).some(v => v && String(v).trim())) {
      state.promptPresets[slug] = { ...opts };
    } else {
      delete state.promptPresets[slug];
    }
    savePromptPresets();
    updatePromptPresetIndicator();
  }

  function updatePromptPresetIndicator() {
    const btn = $('#btn-prompt-settings');
    if (!btn) return;
    const has = !!getPromptPresetFor(state.activeSlug);
    btn.classList.toggle('has-preset', has);
    btn.title = has ? '结构化提示词（当前文章已设置）' : '结构化提示词面板';
  }

  async function loadPromptPresetCatalog() {
    if (state.promptPresetCatalog) return state.promptPresetCatalog;
    try {
      const res = await api._fetch('/api/prompt-presets');
      state.promptPresetCatalog = (res && res.presets) || null;
    } catch (err) {
      state.promptPresetCatalog = {
        style: {}, scene: {}, lighting: {}, composition: {}, quality: {}
      };
    }
    return state.promptPresetCatalog;
  }

  const api = {
    async _fetch(path, opts = {}) {
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
    getConfig() { return this._fetch('/api/config'); },
    putConfig(patch) { return this._fetch('/api/config', { method: 'PUT', body: JSON.stringify(patch) }); },
    listTemplates() { return this._fetch('/api/templates'); },
    listArticles() { return this._fetch('/api/articles'); },
    getArticle(slug) { return this._fetch(`/api/articles/${encodeURIComponent(slug)}`); },
    createArticle(payload) { return this._fetch('/api/articles', { method: 'POST', body: JSON.stringify(payload) }); },
    updateArticle(slug, payload) { return this._fetch(`/api/articles/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(payload) }); },
    deleteArticle(slug) { return this._fetch(`/api/articles/${encodeURIComponent(slug)}`, { method: 'DELETE' }); },
    render(payload) { return this._fetch('/api/render', { method: 'POST', body: JSON.stringify(payload) }); },
    convert(payload) { return this._fetch('/api/convert', { method: 'POST', body: JSON.stringify(payload) }); },
    publish(payload) { return this._fetch('/api/publish', { method: 'POST', body: JSON.stringify(payload) }); },
    generateImage(payload) { return this._fetch('/api/generate-image', { method: 'POST', body: JSON.stringify(payload) }); },
    getStats(params) {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return this._fetch('/api/stats' + qs);
    },
    getTopicsMeta() { return this._fetch('/api/topics/meta'); },
    listTopics() { return this._fetch('/api/topics'); },
    getTopic(slug) { return this._fetch(`/api/topics/${encodeURIComponent(slug)}`); },
    createTopic(payload) { return this._fetch('/api/topics', { method: 'POST', body: JSON.stringify(payload) }); },
    updateTopic(slug, payload) { return this._fetch(`/api/topics/${encodeURIComponent(slug)}`, { method: 'PUT', body: JSON.stringify(payload) }); },
    deleteTopic(slug) { return this._fetch(`/api/topics/${encodeURIComponent(slug)}`, { method: 'DELETE' }); }
  };

  function toast(message, type = 'info', duration = 3500) {
    const root = $('#toast-root');
    const el = document.createElement('div');
    el.className = `toast is-${type}`;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.style.transition = 'opacity 0.2s';
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, duration);
  }

  function modal({ title, body, footer, width }) {
    let resolve_;
    const promise = new Promise((resolve) => { resolve_ = resolve; });
    const tpl = $('#tpl-modal').content.cloneNode(true);
    const root = $('#modal-root');
    const node = tpl.querySelector('[data-modal]');
    const bodyEl = node.querySelector('[data-body]');
    const footEl = node.querySelector('[data-foot]');
    const titleEl = node.querySelector('.modal-title');
    if (title) titleEl.textContent = title;
    if (body instanceof Node) bodyEl.appendChild(body);
    else if (typeof body === 'string') bodyEl.innerHTML = body;
    if (footer) {
      if (footer instanceof Node) footEl.appendChild(footer);
      else if (typeof footer === 'string') footEl.innerHTML = footer;
    } else {
      footEl.remove();
    }
    if (width) node.querySelector('.modal').style.width = width;
    function close(value) {
      node.remove();
      document.removeEventListener('keydown', escHandler);
      resolve_(value);
    }
    node.addEventListener('click', (e) => {
      if (e.target === node) close(null);
      if (e.target.closest('[data-action="close"]')) close(null);
    });
    const escHandler = (e) => {
      if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', escHandler); }
    };
    document.addEventListener('keydown', escHandler);
    root.appendChild(node);
    promise.close = close;
    return promise;
  }

  function confirmDialog(message, opts = {}) {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      body.textContent = message;
      body.style.padding = '8px 0';
      body.style.lineHeight = '1.6';
      const foot = document.createElement('div');
      foot.style.display = 'flex';
      foot.style.gap = '8px';
      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = opts.cancelText || '取消';
      const ok = document.createElement('button');
      ok.className = `btn ${opts.danger ? 'btn-danger' : 'btn-primary'}`;
      ok.textContent = opts.okText || '确定';
      foot.append(cancel, ok);
      const p = modal({ title: opts.title || '确认', body, footer: foot });
      cancel.onclick = () => p.close(false);
      ok.onclick = () => p.close(true);
      p.then(resolve);
    });
  }

  function promptDialog({ title, fields, submitText = '确定', danger = false }) {
    return new Promise((resolve) => {
      const body = document.createElement('div');
      const inputs = {};
      for (const f of fields) {
        const row = document.createElement('div');
        row.className = 'form-row';
        const label = document.createElement('label');
        label.textContent = f.label;
        if (f.hint) {
          const hint = document.createElement('span');
          hint.className = 'hint';
          hint.textContent = f.hint;
          label.appendChild(hint);
        }
        row.appendChild(label);
        const input = document.createElement('input');
        input.type = f.type || 'text';
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.value !== undefined) input.value = f.value;
        if (f.required) input.required = true;
        row.appendChild(input);
        body.appendChild(row);
        inputs[f.name] = input;
      }
      const foot = document.createElement('div');
      foot.style.display = 'flex';
      foot.style.gap = '8px';
      const cancel = document.createElement('button');
      cancel.className = 'btn';
      cancel.textContent = '取消';
      const ok = document.createElement('button');
      ok.className = `btn ${danger ? 'btn-danger' : 'btn-primary'}`;
      ok.textContent = submitText;
      foot.append(cancel, ok);
      const p = modal({ title, body, footer: foot });
      cancel.onclick = () => p.close(null);
      ok.onclick = () => {
        const result = {};
        for (const f of fields) {
          result[f.name] = inputs[f.name].value.trim();
          if (f.required && !result[f.name]) {
            inputs[f.name].focus();
            return;
          }
        }
        p.close(result);
      };
      inputs[fields[0].name].focus();
      p.then(resolve);
    });
  }

  function setStatus(kind, text) {
    const sdot = $('#health-dot');
    const st = $('#health-text');
    if (sdot) { sdot.classList.remove('is-ok', 'is-down', 'is-warn');
      if (kind === 'ok') sdot.classList.add('is-ok');
      else if (kind === 'down') sdot.classList.add('is-down');
      else sdot.classList.add('is-warn');
    }
    if (st) st.textContent = text;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function renderArticleList() {
    const list = $('#article-list');
    const search = state.search.toLowerCase();
    const filter = state.filter;
    const items = state.articles.filter(a => {
      if (filter !== 'all' && a.status !== filter) return false;
      if (search) {
        const haystack = `${a.title} ${a.author} ${(a.tags || []).join(' ')}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
    list.innerHTML = '';
    for (const a of items) {
      const li = document.createElement('li');
      li.className = 'article-item';
      if (a.slug === state.activeSlug) li.classList.add('is-active');
      li.dataset.slug = a.slug;
      const title = document.createElement('div');
      title.className = 'article-item-title';
      title.textContent = a.title;
      const meta = document.createElement('div');
      meta.className = 'article-item-meta';
      const status = document.createElement('span');
      status.className = `article-status is-${a.status}`;
      status.textContent = a.status;
      const date = document.createElement('span');
      date.textContent = formatDate(a.updatedAt);
      meta.append(status, date);
      li.append(title, meta);
      li.addEventListener('click', () => selectArticle(a.slug));
      li.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        confirmDialog(`确定删除「${a.title}」？此操作不可撤销。`, { title: '删除文章', danger: true, okText: '删除' })
          .then(ok => { if (ok) deleteCurrentArticle(a.slug); });
      });
      list.appendChild(li);
    }
    $('#article-count').textContent = `${items.length} / ${state.articles.length} 篇`;
  }

  function refreshArticleList() {
    return api.listArticles().then(articles => {
      state.articles = articles;
      state.articlesBySlug = new Map(articles.map(a => [a.slug, a]));
      renderArticleList();
    });
  }

  function selectArticle(slug) {
    if (state.dirty && state.activeArticle) {
      flushSave().catch(() => {});
    }
    state.activeSlug = slug;
    state.activeArticle = null;
    state.dirty = false;
    return api.getArticle(slug).then(article => {
      state.activeArticle = article;
      state.template = $('#template-select').value || state.template;
      $('#article-title').value = article.title || '';
      $('#article-author').value = article.author || '';
      $('#editor').value = article.content || '';
      state.dirty = false;
      $('#editor-status').textContent = `已加载: ${article.slug}`;
      updateWordCount();
      renderArticleList();
      scheduleRender();
      updatePromptPresetIndicator();
    }).catch(err => {
      toast(`加载文章失败: ${err.message}`, 'error');
    });
  }

  function updateWordCount() {
    const text = $('#editor').value;
    const cnChars = (text.match(/[\u4e00-\u9fff]/g) || []).length;
    const otherChars = text.replace(/[\u4e00-\u9fff\s]/g, '').length;
    $('#editor-words').textContent = `${cnChars + otherChars} 字`;
  }

  function markDirty() {
    state.dirty = true;
    if (state.activeArticle) {
      $('#editor-status').textContent = `编辑中: ${state.activeArticle.slug}（未保存）`;
    }
    if (state.saveTimer) clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flushSave, 1500);
    scheduleRender();
  }

  function flushSave() {
    if (!state.activeArticle || !state.dirty || state.saveInFlight) {
      return Promise.resolve();
    }
    const payload = {
      title: $('#article-title').value.trim(),
      author: $('#article-author').value.trim(),
      content: $('#editor').value
    };
    state.saveInFlight = true;
    return api.updateArticle(state.activeArticle.slug, payload).then(() => {
      state.dirty = false;
      state.lastSavedAt = new Date();
      $('#editor-status').textContent = `已保存: ${state.activeArticle.slug} · ${formatDate(state.lastSavedAt.toISOString())}`;
      return refreshArticleList();
    }).catch(err => {
      toast(`保存失败: ${err.message}`, 'error');
    }).then(() => {
      state.saveInFlight = false;
    });
  }

  function scheduleRender() {
    if (state.renderTimer) clearTimeout(state.renderTimer);
    state.renderTimer = setTimeout(doRender, 400);
  }

  function doRender() {
    if (!state.activeArticle) {
      const frame = $('#preview-frame');
      frame.srcdoc = '<!DOCTYPE html><html><body style="font-family:sans-serif;color:#888;padding:40px;text-align:center">选中文章后预览将出现在此</body></html>';
      $('#preview-template').textContent = '—';
      return;
    }
    const content = $('#editor').value;
    const tpl = $('#template-select').value || state.template;
    const frontmatter = {
      title: $('#article-title').value.trim(),
      author: $('#article-author').value.trim(),
      date: state.activeArticle.date
    };
    api.render({ content, template: tpl, frontmatter }).then(res => {
      const frame = $('#preview-frame');
      frame.srcdoc = res.html;
      $('#preview-template').textContent = tpl;
    }).catch(err => {
      console.warn('render failed', err);
    });
  }

  function insertMarkdown(type) {
    const ta = $('#editor');
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const sel = ta.value.slice(start, end) || '';
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const transforms = {
      bold: () => `**${sel || '加粗文字'}**`,
      italic: () => `*${sel || '斜体文字'}*`,
      code: () => `\`${sel || 'code'}\``,
      link: () => `[${sel || '链接文字'}](https://)`,
      image: () => `![${sel || '描述'}](/assets/images/placeholder.png)`,
      quote: () => `\n> ${sel || '引用内容'}\n`,
      list: () => `\n- ${sel || '列表项'}\n- 第二项\n- 第三项\n`,
      ordered: () => `\n1. ${sel || '步骤一'}\n2. 步骤二\n3. 步骤三\n`,
      codeblock: () => `\n\`\`\`javascript\n${sel || 'console.log("hello");'}\n\`\`\`\n`
    };
    const inserted = transforms[type] ? transforms[type]() : sel;
    let prefix = before;
    let suffix = after;
    if (['quote', 'list', 'ordered', 'codeblock'].includes(type)) {
      if (prefix.length > 0 && !prefix.endsWith('\n')) prefix += '\n';
    }
    if (['image', 'link', 'code'].includes(type)) {
      if (prefix.length > 0 && !prefix.endsWith(' ') && !prefix.endsWith('\n')) prefix += ' ';
    }
    ta.value = prefix + inserted + suffix;
    ta.focus();
    const cursor = (prefix + inserted).length;
    ta.setSelectionRange(cursor, cursor);
    markDirty();
  }

  async function openPromptSettings() {
    if (!state.activeSlug) {
      toast('请先选中或新建一篇文章', 'warn');
      return;
    }
    const catalog = await loadPromptPresetCatalog();
    const current = getPromptPresetFor(state.activeSlug) || {};
    const body = document.createElement('div');

    const textRow = (label, name, placeholder) => {
      const row = document.createElement('div');
      row.className = 'form-row';
      const l = document.createElement('label');
      l.textContent = label;
      row.appendChild(l);
      const input = document.createElement('input');
      input.type = 'text';
      input.name = name;
      if (placeholder) input.placeholder = placeholder;
      input.value = current[name] || '';
      input.dataset.kind = 'text';
      row.appendChild(input);
      body.appendChild(row);
      return input;
    };
    const selectRow = (label, name, options) => {
      const row = document.createElement('div');
      row.className = 'form-row';
      const l = document.createElement('label');
      l.textContent = label;
      row.appendChild(l);
      const sel = document.createElement('select');
      sel.name = name;
      sel.dataset.kind = 'select';
      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = '（不指定）';
      sel.appendChild(blank);
      for (const k of Object.keys(options || {})) {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = k;
        if (k === (current[name] || '')) opt.selected = true;
        sel.appendChild(opt);
      }
      row.appendChild(sel);
      body.appendChild(row);
      return sel;
    };

    const subjectInput = textRow('主体（必填）', 'subject', '例如：一只在雨中漫步的黑猫');
    selectRow('场景 / 环境', 'scene', catalog.scene);
    selectRow('风格', 'style', catalog.style);
    selectRow('光照', 'lighting', catalog.lighting);
    selectRow('构图', 'composition', catalog.composition);
    selectRow('质量要求', 'quality', catalog.quality);

    const presetType = document.createElement('div');
    presetType.className = 'form-row';
    const l = document.createElement('label');
    l.textContent = '生成类型';
    presetType.appendChild(l);
    const sel = document.createElement('select');
    sel.name = '__type';
    for (const t of [
      { v: 'inline', label: '插图 (inline)' },
      { v: 'cover', label: '封面 (cover)' }
    ]) {
      const opt = document.createElement('option');
      opt.value = t.v;
      opt.textContent = t.label;
      if (t.v === (current.__type || 'inline')) opt.selected = true;
      sel.appendChild(opt);
    }
    presetType.appendChild(sel);
    body.appendChild(presetType);

    const note = document.createElement('div');
    note.className = 'field-hint';
    note.textContent = '设置仅保存在本地浏览器，按文章维度记忆；点击「保存」立即应用，点击「生成」按当前选项生成图片。';
    body.appendChild(note);

    const previewSlot = document.createElement('div');
    body.appendChild(previewSlot);

    const foot = document.createElement('div');
    foot.style.display = 'flex';
    foot.style.gap = '8px';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = '取消';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'btn';
    clearBtn.textContent = '清除';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn';
    saveBtn.textContent = '保存';
    const generateBtn = document.createElement('button');
    generateBtn.className = 'btn btn-primary';
    generateBtn.textContent = '生成';
    foot.append(cancelBtn, clearBtn, saveBtn, generateBtn);

    const insertBtn = document.createElement('button');
    insertBtn.className = 'btn btn-accent';
    insertBtn.textContent = '插入到编辑器';
    insertBtn.style.display = 'none';
    foot.append(insertBtn);

    const p = modal({ title: '🎯 结构化提示词', body, footer: foot, width: '520px' });

    function readForm() {
      const opts = {};
      for (const el of body.querySelectorAll('[data-kind]')) {
        if (el.dataset.kind === 'text') opts.subject = el.value;
        else opts[el.name] = el.value;
      }
      opts.__type = body.querySelector('select[name="__type"]').value;
      return opts;
    }

    cancelBtn.onclick = () => p.close(null);
    clearBtn.onclick = () => {
      setPromptPresetFor(state.activeSlug, null);
      body.querySelectorAll('[data-kind]').forEach(el => { el.value = ''; });
      body.querySelector('select[name="__type"]').value = 'inline';
      toast('已清除当前文章的结构化提示词');
    };
    saveBtn.onclick = () => {
      const opts = readForm();
      const cleaned = { ...opts };
      delete cleaned.__type;
      setPromptPresetFor(state.activeSlug, cleaned);
      toast('已保存', 'success');
    };
    let lastResult = null;
    generateBtn.onclick = async () => {
      const opts = readForm();
      const cleaned = { ...opts };
      const type = cleaned.__type || 'inline';
      delete cleaned.__type;
      if (!cleaned.subject || !cleaned.subject.trim()) {
        toast('请先填写「主体」字段', 'warn');
        return;
      }
      const cleanedNoSubject = { ...cleaned };
      delete cleanedNoSubject.subject;
      const hasAny = Object.values(cleanedNoSubject).some(v => v && String(v).trim());
      if (!hasAny) {
        toast('至少选择一个分类（场景/风格/光照/构图/质量）', 'warn');
        return;
      }
      setPromptPresetFor(state.activeSlug, cleaned);
      previewSlot.innerHTML = '';
      generateBtn.classList.add('chip-loading');
      generateBtn.disabled = true;
      try {
        const fd = { type, promptOptions: cleaned };
        if (type === 'cover') fd.title = $('#article-title').value.trim() || cleaned.subject;
        else fd.description = cleaned.subject;
        fd.template = $('#template-select').value || state.template;
        lastResult = await api.generateImage(fd);
        const img = document.createElement('img');
        img.className = 'gen-preview';
        img.src = lastResult.url;
        img.alt = lastResult.path;
        const meta = document.createElement('div');
        meta.className = 'field-hint';
        meta.textContent = `已保存: ${lastResult.path}（远程: 已上传）`;
        previewSlot.append(img, meta);
        insertBtn.style.display = '';
      } catch (err) {
        const body2 = err.body || {};
        const errEl = document.createElement('div');
        errEl.className = 'gen-error';
        errEl.textContent = `${body2.error || err.message}${body2.hint ? '\n💡 ' + body2.hint : ''}`;
        previewSlot.appendChild(errEl);
      } finally {
        generateBtn.classList.remove('chip-loading');
        generateBtn.disabled = false;
      }
    };
    insertBtn.onclick = () => {
      if (!lastResult) return;
      const type = body.querySelector('select[name="__type"]').value;
      insertGeneratedImage(type, lastResult);
      p.close(true);
    };
    p.then(() => {});
  }

  function formatStay(percent) {
    if (percent == null || isNaN(percent)) return '—';
    const n = Number(percent);
    return `${(n * 100).toFixed(1)}%`;
  }

  function flattenStatsList(list) {
    const rows = [];
    for (const day of list || []) {
      const ref = day.ref_date || '';
      for (const d of day.details || []) {
        rows.push({
          ref_date: ref,
          msgid: d.msgid,
          title: d.title || '(无标题)',
          target_user: d.target_user,
          int_page_read_user: d.int_page_read_user,
          int_page_read_count: d.int_page_read_count,
          share_user: d.share_user,
          share_count: d.share_count,
          add_to_fav_user: d.add_to_fav_user,
          add_to_fav_count: d.add_to_fav_count,
          ori_page_read_user: d.ori_page_read_user,
          stay_offline_percent: d.stay_offline_percent
        });
      }
    }
    rows.sort((a, b) => (a.ref_date < b.ref_date ? 1 : a.ref_date > b.ref_date ? -1 : 0));
    return rows;
  }

  function renderStatsTable(rows) {
    const totals = rows.reduce((acc, r) => {
      acc.int_page_read_user += Number(r.int_page_read_user) || 0;
      acc.int_page_read_count += Number(r.int_page_read_count) || 0;
      acc.share_user += Number(r.share_user) || 0;
      acc.add_to_fav_user += Number(r.add_to_fav_user) || 0;
      acc.ori_page_read_user += Number(r.ori_page_read_user) || 0;
      return acc;
    }, { int_page_read_user: 0, int_page_read_count: 0, share_user: 0, add_to_fav_user: 0, ori_page_read_user: 0 });
    const stayVals = rows.map(r => Number(r.stay_offline_percent)).filter(n => !isNaN(n));
    const avgStay = stayVals.length ? stayVals.reduce((a, b) => a + b, 0) / stayVals.length : null;

    const table = document.createElement('table');
    table.className = 'stats-table';
    table.innerHTML = `
      <thead>
        <tr>
          <th>日期</th>
          <th>文章</th>
          <th>阅读人数</th>
          <th>阅读次数</th>
          <th>分享人数</th>
          <th>收藏人数</th>
          <th>原文阅读</th>
          <th>留存率</th>
        </tr>
      </thead>
      <tbody></tbody>
      <tfoot>
        <tr class="stats-summary">
          <td colspan="2">合计（${rows.length} 条）</td>
          <td>${totals.int_page_read_user}</td>
          <td>${totals.int_page_read_count}</td>
          <td>${totals.share_user}</td>
          <td>${totals.add_to_fav_user}</td>
          <td>${totals.ori_page_read_user}</td>
          <td>${formatStay(avgStay)}</td>
        </tr>
      </tfoot>
    `;
    const tbody = table.querySelector('tbody');
    if (rows.length === 0) {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td colspan="8" class="stats-empty">该时段内无数据</td>`;
      tbody.appendChild(tr);
      return table;
    }
    for (const r of rows) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.ref_date}</td>
        <td class="stats-title">${escapeHtml(r.title)}</td>
        <td>${r.int_page_read_user}</td>
        <td>${r.int_page_read_count}</td>
        <td>${r.share_user}</td>
        <td>${r.add_to_fav_user}</td>
        <td>${r.ori_page_read_user}</td>
        <td>${formatStay(r.stay_offline_percent)}</td>
      `;
      tbody.appendChild(tr);
    }
    return table;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[ch]));
  }

  async function openStats() {
    const body = document.createElement('div');

    const rangeWrap = document.createElement('div');
    rangeWrap.className = 'stats-range';
    const chips = [
      { v: 7, label: '7天' },
      { v: 30, label: '30天' },
      { v: 90, label: '90天' }
    ];
    let currentRange = { days: 7 };
    function makeChip(c) {
      const b = document.createElement('button');
      b.className = 'filter-chip';
      b.type = 'button';
      b.textContent = c.label;
      b.dataset.days = c.v;
      if (c.v === 7) b.classList.add('is-active');
      b.addEventListener('click', () => {
        chips.forEach(x => x.elem.classList.remove('is-active'));
        b.classList.add('is-active');
        customDate.style.display = 'none';
        currentRange = { days: c.v };
        runFetch();
      });
      c.elem = b;
      return b;
    }
    chips.forEach(c => rangeWrap.appendChild(makeChip(c)));
    const customChip = document.createElement('button');
    customChip.className = 'filter-chip';
    customChip.type = 'button';
    customChip.textContent = '自定义';
    customChip.addEventListener('click', () => {
      chips.forEach(x => x.elem.classList.remove('is-active'));
      customChip.classList.add('is-active');
      customDate.style.display = '';
      const today = new Date();
      const week = new Date(today.getTime() - 6 * 86400000);
      endInput.value = today.toISOString().slice(0, 10);
      startInput.value = week.toISOString().slice(0, 10);
    });
    rangeWrap.appendChild(customChip);
    body.appendChild(rangeWrap);

    const customDate = document.createElement('div');
    customDate.className = 'stats-custom';
    customDate.style.display = 'none';
    const startLabel = document.createElement('label');
    startLabel.textContent = '开始日期';
    const startInput = document.createElement('input');
    startInput.type = 'date';
    startInput.className = 'input';
    const endLabel = document.createElement('label');
    endLabel.textContent = '结束日期';
    const endInput = document.createElement('input');
    endInput.type = 'date';
    endInput.className = 'input';
    const applyBtn = document.createElement('button');
    applyBtn.className = 'btn';
    applyBtn.type = 'button';
    applyBtn.textContent = '查询';
    applyBtn.addEventListener('click', () => {
      if (!startInput.value || !endInput.value) {
        toast('请选择起止日期', 'warn');
        return;
      }
      if (startInput.value > endInput.value) {
        toast('开始日期不能晚于结束日期', 'warn');
        return;
      }
      currentRange = { start: startInput.value, end: endInput.value };
      runFetch();
    });
    customDate.append(startLabel, startInput, endLabel, endInput, applyBtn);
    body.appendChild(customDate);

    const meta = document.createElement('div');
    meta.className = 'stats-meta muted';
    meta.textContent = '加载中…';
    body.appendChild(meta);

    const tableSlot = document.createElement('div');
    tableSlot.className = 'stats-slot';
    body.appendChild(tableSlot);

    const foot = document.createElement('div');
    foot.style.display = 'flex';
    foot.style.gap = '8px';
    foot.style.justifyContent = 'flex-end';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'btn';
    closeBtn.textContent = '关闭';
    foot.appendChild(closeBtn);

    const p = modal({ title: '📊 数据复盘', body, footer: foot, width: '760px' });
    closeBtn.onclick = () => p.close(null);

    let lastReqToken = 0;
    async function runFetch() {
      const myToken = ++lastReqToken;
      tableSlot.innerHTML = '';
      meta.textContent = '加载中…';
      try {
        const data = await api.getStats(currentRange);
        if (myToken !== lastReqToken) return;
        const rows = flattenStatsList(data.list);
        meta.textContent = `区间: ${data.range.start} → ${data.range.end} · 共 ${rows.length} 条记录`;
        tableSlot.appendChild(renderStatsTable(rows));
      } catch (err) {
        if (myToken !== lastReqToken) return;
        meta.textContent = '';
        const empty = document.createElement('div');
        empty.className = 'stats-empty-block';
        const body2 = err.body || {};
        if (err.status === 400 && /credentials/i.test(body2.error || err.message)) {
          empty.innerHTML = `
            <div class="stats-empty-title">微信凭据未配置</div>
            <div class="stats-empty-hint muted">请在「设置」中填写 app_id 和 app_secret，或设置 WECHAT_APP_ID / WECHAT_APP_SECRET 环境变量后重启服务。</div>
          `;
        } else {
          empty.innerHTML = `
            <div class="stats-empty-title">加载失败</div>
            <div class="stats-empty-hint muted">${escapeHtml(body2.error || err.message)}</div>
          `;
        }
        tableSlot.appendChild(empty);
      }
    }
    runFetch();
  }

  async function openGenerateImage(type) {
    if (!state.activeArticle) {
      toast('请先选中或新建一篇文章', 'warn');
      return;
    }
    const fields = [];
    if (type === 'cover') {
      fields.push({ name: 'title', label: '封面主题', value: $('#article-title').value.trim(), placeholder: '封面要表达的主题', required: true });
    }
    fields.push({ name: 'description', label: '描述（可选）', placeholder: '给 AI 一些提示词，例如：蓝色科技感、简约、温暖' });
    fields.push({
      name: 'template', label: '风格模板', value: state.template,
      type: 'select'
    });
    fields.push({ name: 'template_label', label: '可选模板' });
    const body = document.createElement('div');
    for (const f of fields) {
      const row = document.createElement('div');
      row.className = 'form-row';
      const label = document.createElement('label');
      label.textContent = f.label;
      row.appendChild(label);
      let input;
      if (f.name === 'template') {
        input = document.createElement('select');
        for (const t of state.templates) {
          const opt = document.createElement('option');
          opt.value = t.name;
          opt.textContent = `${t.name} — ${t.label}`;
          if (t.name === f.value) opt.selected = true;
          input.appendChild(opt);
        }
      } else {
        input = document.createElement('input');
        input.type = 'text';
        if (f.placeholder) input.placeholder = f.placeholder;
        if (f.value) input.value = f.value;
        if (f.required) input.required = true;
      }
      row.appendChild(input);
      body.appendChild(row);
    }
    const note = document.createElement('div');
    note.className = 'field-hint';
    note.textContent = '生成中可能需要 10-30 秒，请耐心等待';
    body.appendChild(note);

    const previewSlot = document.createElement('div');
    body.appendChild(previewSlot);

    const foot = document.createElement('div');
    foot.style.display = 'flex';
    foot.style.gap = '8px';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = '取消';
    const generateBtn = document.createElement('button');
    generateBtn.className = 'btn btn-primary';
    generateBtn.textContent = type === 'cover' ? '🎨 生成封面' : '🖼 生成插图';
    foot.append(cancelBtn, generateBtn);
    const insertBtn = document.createElement('button');
    insertBtn.className = 'btn btn-accent';
    insertBtn.textContent = '插入到编辑器';
    insertBtn.style.display = 'none';
    foot.append(insertBtn);

    const p = modal({ title: type === 'cover' ? '生成封面图' : '生成插图', body, footer: foot, width: '480px' });

    let result = null;
    cancelBtn.onclick = () => p.close(null);
    insertBtn.onclick = () => {
      if (!result) return;
      insertGeneratedImage(type, result);
      p.close(true);
    };
    generateBtn.onclick = async () => {
      previewSlot.innerHTML = '';
      generateBtn.classList.add('chip-loading');
      generateBtn.disabled = true;
      try {
        const fd = {
          type,
          title: body.querySelectorAll('input')[0]?.value || '',
          description: body.querySelectorAll('input')[1]?.value || '',
          template: body.querySelector('select').value
        };
        const preset = getPromptPresetFor(state.activeSlug);
        if (preset) fd.promptOptions = preset;
        result = await api.generateImage(fd);
        const img = document.createElement('img');
        img.className = 'gen-preview';
        img.src = result.url;
        img.alt = result.path;
        const meta = document.createElement('div');
        meta.className = 'field-hint';
        meta.textContent = `已保存: ${result.path}（远程: ${result.remoteUrl || '已上传'})`;
        previewSlot.append(img, meta);
        insertBtn.style.display = '';
      } catch (err) {
        const body2 = err.body || {};
        const errEl = document.createElement('div');
        errEl.className = 'gen-error';
        errEl.textContent = `${body2.error || err.message}${body2.hint ? '\n💡 ' + body2.hint : ''}`;
        previewSlot.appendChild(errEl);
      } finally {
        generateBtn.classList.remove('chip-loading');
        generateBtn.disabled = false;
      }
    };
    p.then(v => { /* close handled by buttons */ });
  }

  function insertGeneratedImage(type, result) {
    const md = type === 'cover'
      ? `![cover](${result.url})`
      : `![illustration](${result.url})`;
    const ta = $('#editor');
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const before = ta.value.slice(0, start);
    const after = ta.value.slice(end);
    const needLead = before.length > 0 && !before.endsWith('\n');
    const needTrail = after.length > 0 && !after.startsWith('\n');
    const inserted = `${needLead ? '\n' : ''}${md}${needTrail ? '\n' : ''}`;
    ta.value = before + inserted + after;
    const cursor = (before + inserted).length;
    ta.focus();
    ta.setSelectionRange(cursor, cursor);
    markDirty();
    toast(`已插入${type === 'cover' ? '封面' : '插图'}: ${result.path}`, 'success');
  }

  function newArticle() {
    return promptDialog({
      title: '新建文章',
      submitText: '创建',
      fields: [
        { name: 'title', label: '标题', placeholder: '文章标题', required: true },
        { name: 'author', label: '作者', placeholder: '留空则不填' }
      ]
    }).then(res => {
      if (!res) return null;
      return api.createArticle({
        title: res.title,
        author: res.author,
        content: `# ${res.title}\n\n开始写…\n`
      }).then(r => r.slug);
    }).then(slug => {
      if (!slug) return;
      return refreshArticleList().then(() => selectArticle(slug));
    }).then(() => toast('文章已创建', 'success'))
      .catch(err => toast(`创建失败: ${err.message}`, 'error'));
  }

  function deleteCurrentArticle(slug) {
    api.deleteArticle(slug).then(() => {
      if (state.activeSlug === slug) {
        state.activeSlug = null;
        state.activeArticle = null;
        $('#article-title').value = '';
        $('#article-author').value = '';
        $('#editor').value = '';
        $('#editor-status').textContent = '未选中文章';
        doRender();
      }
      return refreshArticleList();
    }).then(() => toast('已删除', 'success'))
      .catch(err => toast(`删除失败: ${err.message}`, 'error'));
  }

  function exportHtml() {
    if (!state.activeArticle) {
      toast('请先选中一篇文章', 'warn');
      return;
    }
    flushSave().then(() => {
      return api.convert({ slug: state.activeArticle.slug, template: $('#template-select').value });
    }).then(res => {
      toast(`已导出: ${res.path}`, 'success', 5000);
    }).catch(err => toast(`导出失败: ${err.message}`, 'error'));
  }

  function publishArticle() {
    if (!state.activeArticle) {
      toast('请先选中一篇文章', 'warn');
      return;
    }
    flushSave().then(() => {
      return api.publish({ slug: state.activeArticle.slug, template: $('#template-select').value });
    }).then(res => {
      if (res.mode === 'simulated') {
        toast(`微信凭据未配置，已模拟发布到 ${res.path}`, 'warn', 6000);
      } else {
        toast(`已推送到微信草稿箱: ${res.draft.media_id || 'OK'}`, 'success');
      }
    }).catch(err => toast(`发布失败: ${err.message}`, 'error'));
  }

  function openSettings() {
    const MASK_PLACEHOLDER = '••••••••';
    const body = document.createElement('div');

    const wechatSec = document.createElement('div');
    wechatSec.className = 'form-section';
    const wechatHead = document.createElement('h3');
    wechatHead.className = 'form-section-title';
    wechatHead.innerHTML = `微信公众号 <span id="wechat-pill" class="section-pill">…</span>`;
    wechatSec.appendChild(wechatHead);
    wechatSec.appendChild(buildField({
      name: 'wechat.app_id',
      label: 'AppID',
      placeholder: '微信公众平台 AppID',
      value: state.config?.wechat?.app_id || ''
    }));
    wechatSec.appendChild(buildField({
      name: 'wechat.app_secret',
      label: 'AppSecret',
      type: 'password',
      placeholder: '微信公众平台 AppSecret',
      value: state.config?.wechat?.app_secret || ''
    }));
    body.appendChild(wechatSec);

    const aiSec = document.createElement('div');
    aiSec.className = 'form-section';
    const aiHead = document.createElement('h3');
    aiHead.className = 'form-section-title';
    aiHead.innerHTML = `AI 配图密钥 <span id="imagegen-pill" class="section-pill">…</span>`;
    aiSec.appendChild(aiHead);
    aiSec.appendChild(buildField({
      name: 'imageGen.apiKey',
      label: 'Agnes API Key',
      type: 'password',
      placeholder: 'sk-xxxx  (留空则清除)',
      value: state.config?.imageGen?.apiKey || ''
    }));
    const apiKeyHint = document.createElement('div');
    apiKeyHint.className = 'field-hint';
    apiKeyHint.textContent = '密钥保存后立即生效，下一次生图请求即可使用。也可设置环境变量 AGNES_API_KEY（优先级高于此配置）。';
    aiSec.appendChild(apiKeyHint);
    body.appendChild(aiSec);

    const tplSec = document.createElement('div');
    tplSec.className = 'form-section';
    const tplHead = document.createElement('h3');
    tplHead.className = 'form-section-title';
    tplHead.textContent = '默认设置';
    tplSec.appendChild(tplHead);

    const tplRow = document.createElement('div');
    tplRow.className = 'form-row';
    const tplLabel = document.createElement('label');
    tplLabel.textContent = '默认模板';
    tplRow.appendChild(tplLabel);
    const tplSelect = document.createElement('select');
    tplSelect.name = 'default_template';
    for (const t of state.templates) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = `${t.name} — ${t.label}`;
      if (t.name === (state.config?.default_template || 'minimal')) opt.selected = true;
      tplSelect.appendChild(opt);
    }
    tplRow.appendChild(tplSelect);
    tplSec.appendChild(tplRow);
    body.appendChild(tplSec);

    const notice = document.createElement('div');
    notice.className = 'field-hint';
    notice.innerHTML = '⚠️ 凭据将明文保存到 <code>config.json</code>（提交代码时请确认仓库权限）。';
    body.appendChild(notice);

    const foot = document.createElement('div');
    foot.style.display = 'flex';
    foot.style.gap = '8px';
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = '取消';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = '保存';
    foot.append(cancelBtn, saveBtn);
    const p = modal({ title: '设置', body, footer: foot, width: '520px' });

    const updatePills = () => {
      const wechatPill = wechatSec.querySelector('#wechat-pill');
      const aiPill = aiSec.querySelector('#imagegen-pill');
      const appIdVal = body.querySelector('input[name="wechat.app_id"]').value.trim();
      const appSecretVal = body.querySelector('input[name="wechat.app_secret"]').value.trim();
      const aiVal = body.querySelector('input[name="imageGen.apiKey"]').value.trim();
      const isSecretMasked = v => v === MASK_PLACEHOLDER;
      const wechatOk = (appIdVal && !isSecretMasked(appIdVal)) && (appSecretVal && !isSecretMasked(appSecretVal));
      const aiOk = aiVal && !isSecretMasked(aiVal);
      wechatPill.className = `section-pill ${wechatOk ? 'is-ok' : 'is-warn'}`;
      wechatPill.textContent = wechatOk ? '已配置' : '未配置';
      aiPill.className = `section-pill ${aiOk ? 'is-ok' : 'is-warn'}`;
      aiPill.textContent = aiOk ? '已配置' : '未配置';
    };
    body.addEventListener('input', updatePills);
    updatePills();

    cancelBtn.onclick = () => p.close(null);
    saveBtn.onclick = async () => {
      saveBtn.disabled = true;
      saveBtn.classList.add('chip-loading');
      const patch = {
        wechat: {
          app_id: body.querySelector('input[name="wechat.app_id"]').value.trim(),
          app_secret: body.querySelector('input[name="wechat.app_secret"]').value.trim()
        },
        imageGen: {
          apiKey: body.querySelector('input[name="imageGen.apiKey"]').value.trim()
        },
        default_template: tplSelect.value
      };
      try {
        const res = await api.putConfig(patch);
        state.config = res.config;
        state.summary = res.summary;
        updatePills();
        await refreshConfig();
        toast('配置已保存到 config.json', 'success');
        p.close(true);
      } catch (err) {
        toast(`保存失败: ${err.message}`, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.classList.remove('chip-loading');
      }
    };
    p.then(() => {});
  }

  function buildField({ name, label, type, placeholder, value }) {
    const row = document.createElement('div');
    row.className = 'form-row';
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    row.appendChild(labelEl);
    const input = document.createElement('input');
    input.name = name;
    input.type = type || 'text';
    if (placeholder) input.placeholder = placeholder;
    if (value) input.value = value;
    row.appendChild(input);
    return row;
  }

  function refreshConfig() {
    return api.getConfig().then(res => {
      state.config = res.config;
      state.summary = res.summary;
      applyConfigToUI();
    });
  }

  function applyConfigToUI() {
    const aiEnabled = state.summary?.imageGen_configured;
    $$('.chip-ai').forEach(b => {
      if (aiEnabled) {
        b.removeAttribute('aria-disabled');
        b.title = b.title.replace('（需先在设置中配置密钥）', '');
      } else {
        b.setAttribute('aria-disabled', 'true');
        b.title = (b.title || 'AI 生图') + '（需先在设置中配置密钥）';
      }
    });
  }

  function bindEvents() {
    $('#article-search').addEventListener('input', (e) => {
      state.search = e.target.value;
      renderArticleList();
    });
    $$('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        $$('.filter-chip').forEach(c => { c.classList.remove('is-active'); c.setAttribute('aria-selected', 'false'); });
        chip.classList.add('is-active');
        chip.setAttribute('aria-selected', 'true');
        state.filter = chip.dataset.filter;
        renderArticleList();
      });
    });
    $('#btn-new-article').addEventListener('click', newArticle);
    $('#btn-save').addEventListener('click', () => flushSave().then(() => toast('已保存')));
    $('#btn-convert').addEventListener('click', exportHtml);
    $('#btn-publish').addEventListener('click', publishArticle);
    $('#btn-stats').addEventListener('click', openStats);
    $('#btn-settings').addEventListener('click', openSettings);

    $('#template-select').addEventListener('change', () => {
      state.template = $('#template-select').value;
      scheduleRender();
    });

    $('#article-title').addEventListener('input', markDirty);
    $('#article-author').addEventListener('input', markDirty);
    $('#editor').addEventListener('input', () => { updateWordCount(); markDirty(); });

    $$('.chip[data-md]').forEach(chip => {
      chip.addEventListener('click', () => {
        const action = chip.dataset.md;
        if (action === 'cover' || action === 'inline') {
          openGenerateImage(action);
        } else if (action === 'prompt') {
          openPromptSettings();
        } else {
          insertMarkdown(action);
        }
      });
    });

    loadPromptPresets();
    updatePromptPresetIndicator();

    document.addEventListener('keydown', (e) => {
      const meta = e.ctrlKey || e.metaKey;
      if (meta && e.key === 's') {
        e.preventDefault();
        flushSave().then(() => toast('已保存'));
      } else if (meta && e.key === 'n') {
        e.preventDefault();
        newArticle();
      } else if (meta && e.key === 'b' && document.activeElement === $('#editor')) {
        e.preventDefault();
        insertMarkdown('bold');
      } else if (meta && e.key === 'i' && document.activeElement === $('#editor')) {
        e.preventDefault();
        insertMarkdown('italic');
      }
    });

    window.addEventListener('beforeunload', (e) => {
      if (state.dirty) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function init() {
    bindEvents();
    setStatus('warn', '连接中…');
    Promise.all([
      api.health().catch(err => { throw err; }),
      api.listTemplates().catch(() => []),
      api.getConfig().catch(() => null),
      api.listArticles().catch(() => [])
    ]).then(([health, templates, configRes, articles]) => {
      const wechatOk = configRes?.summary?.wechat_configured || health?.wechatConfigured;
      const imgOk = configRes?.summary?.imageGen_configured || health?.imageGenConfigured;
      const parts = [];
      if (wechatOk) parts.push('微信已配置');
      else parts.push('微信未配置');
      if (imgOk) parts.push('AI 配图已配置');
      else parts.push('AI 配图未配置');
      setStatus('ok', parts.join(' · '));
      state.templates = templates;
      state.config = configRes?.config;
      state.summary = configRes?.summary || health;
      const sel = $('#template-select');
      sel.innerHTML = '';
      for (const t of templates) {
        const opt = document.createElement('option');
        opt.value = t.name;
        opt.textContent = `${t.name} — ${t.label}`;
        if (t.name === (configRes?.config?.default_template || 'minimal')) opt.selected = true;
        sel.appendChild(opt);
      }
      state.template = sel.value;
      state.articles = articles;
      state.articlesBySlug = new Map(articles.map(a => [a.slug, a]));
      renderArticleList();
      applyConfigToUI();
      if (articles.length > 0) {
        selectArticle(articles[0].slug);
      } else {
        seedSampleArticle().finally(() => doRender());
      }
    }).catch(err => {
      console.error('init failed', err);
      setStatus('down', '后端连接失败');
      toast(`后端连接失败: ${err.message}`, 'error', 5000);
    });
  }

  const SAMPLE_ARTICLE_BODY = `# 欢迎使用 WeChat Workflow

这是一篇**示例文章**，演示了 Markdown 转微信公众号样式的核心排版能力。

## 文本样式

普通段落，用于测试基础排版。**加粗** 和 *斜体* 以及 ~~删除线~~。

> 这是引用块，用于突出某段重要文字。

## 列表

- 无序项 1
- 无序项 2
- 无序项 3

1. 有序第一步
2. 有序第二步
3. 有序第三步

## 代码

行内 \`const x = 1\`。

\`\`\`javascript
function hello() {
  console.log("Hello, WeChat!");
  return true;
}
\`\`\`

## 表格

| 功能 | 状态 |
|------|------|
| 封面/插图生成 | 已支持 |
| 模板切换 | 已支持 |
| 微信发布 | 已支持 |

## 链接

[示例链接](https://example.com)

---

试着编辑这篇内容，或者点右上角「+ 新建文章」开始写自己的稿子吧。`;

  async function seedSampleArticle() {
    try {
      const result = await api.createArticle({
        title: '欢迎使用 WeChat Workflow',
        author: 'Multica',
        content: SAMPLE_ARTICLE_BODY,
        tags: ['welcome', 'sample'],
        status: 'draft'
      });
      const articles = await api.listArticles();
      state.articles = articles;
      state.articlesBySlug = new Map(articles.map(a => [a.slug, a]));
      renderArticleList();
      if (result && result.slug) {
        selectArticle(result.slug);
        toast(`已创建示例文章: ${result.slug}`, 'success');
      }
    } catch (err) {
      console.warn('seed sample article failed', err);
    }
  }

  const SAMPLE_TOPICS = [
    {
      title: 'AI 写作工具横评：Claude / GPT / DeepSeek 实测对比',
      summary: '从「公众号写作」这个具体场景出发，对比三款主流大模型在中文长文、配图指令、Markdown 严谨度上的表现，附真实 prompt 样例。',
      source: 'https://anthropic.com/news',
      status: 'idea',
      priority: 'P1'
    },
    {
      title: '我用 Vercel Blob 做公众号素材库的一年',
      summary: '讲讲把图片/封面托管在 Vercel Blob 上的真实账单、踩坑与备份策略，适合个人创作者。',
      source: 'vercel.com/docs/storage',
      status: 'researching',
      priority: 'P2'
    },
    {
      title: '从 0 到 1000 粉：一个技术公众号的复盘',
      summary: '记录 6 个月内从 0 到 1000 关注者的过程，重点讲内容选题、排版迭代和发布节奏。',
      source: '内部回顾',
      status: 'writing',
      priority: 'P0'
    },
    {
      title: '微信草稿箱自动化：把 Markdown 推送到公众号的 5 个方案',
      summary: '微信 API 调通的踩坑全记录，从最简单的 curl 到 webhook 自动化。',
      source: 'developers.weixin.qq.com',
      status: 'done',
      priority: 'P2'
    }
  ];

  async function seedSampleTopics() {
    try {
      for (const t of SAMPLE_TOPICS) {
        try {
          await api.createTopic(t);
        } catch (err) {
          if (!/409|already exists/i.test(err.message || '')) {
            console.warn('seed sample topic failed', err);
          }
        }
      }
      await refreshTopicList();
      toast(`已载入 ${SAMPLE_TOPICS.length} 个示例选题`, 'success', 4000);
    } catch (err) {
      console.warn('seed sample topics failed', err);
    }
  }

  // === Topic board ===

  const TOPIC_STATUSES = [
    { value: 'idea', label: '想法' },
    { value: 'researching', label: '预研' },
    { value: 'writing', label: '写作中' },
    { value: 'done', label: '已完成' },
    { value: 'published', label: '已发布' },
    { value: 'shelved', label: '搁置' }
  ];

  const TOPIC_PRIORITIES = [
    { value: 'P0', label: 'P0 紧急' },
    { value: 'P1', label: 'P1 高' },
    { value: 'P2', label: 'P2 中' },
    { value: 'P3', label: 'P3 低' }
  ];

  const statusMeta = (value) => TOPIC_STATUSES.find(s => s.value === value) || { value, label: value };
  const priorityMeta = (value) => TOPIC_PRIORITIES.find(p => p.value === value) || { value, label: value };

  function setActiveView(name) {
    state.view = name;
    $$('.topbar-nav-item').forEach(btn => {
      const active = btn.dataset.view === name;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    const viewArticles = $('#view-articles');
    const viewTopics = $('#view-topics');
    if (viewArticles) {
      viewArticles.hidden = name !== 'articles';
      viewArticles.style.display = name === 'articles' ? '' : 'none';
    }
    if (viewTopics) {
      viewTopics.hidden = name !== 'topics';
      viewTopics.style.display = name === 'topics' ? '' : 'none';
    }
    if (name === 'topics') {
      if (state.topics.length === 0) {
        refreshTopicList().catch(err => console.warn('refreshTopicList failed', err));
      } else {
        renderBoard();
      }
    }
  }

  async function refreshTopicList() {
    const [topics, meta] = await Promise.all([
      api.listTopics().catch(err => { console.warn('listTopics failed', err); return []; }),
      state.topicsMeta.statuses.length ? Promise.resolve(state.topicsMeta) : api.getTopicsMeta().catch(() => null)
    ]);
    state.topics = topics || [];
    state.topicsBySlug = new Map(state.topics.map(t => [t.slug, t]));
    if (meta) state.topicsMeta = meta;
    renderBoard();
  }

  function filterTopics() {
    const q = (state.topicSearch || '').toLowerCase().trim();
    if (!q) return state.topics.slice();
    return state.topics.filter(t => {
      const hay = `${t.title} ${t.summary || ''} ${t.source || ''} ${(t.tags || []).join(' ')}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderBoard() {
    const items = filterTopics();
    $('#topic-count').textContent = `${items.length} / ${state.topics.length} 个`;
    if (state.boardView === 'kanban') {
      renderKanban(items);
    } else {
      renderTopicListTable(items);
    }
  }

  function renderKanban(items) {
    const board = $('#kanban-board');
    const list = $('#topic-list-wrap');
    if (!board) return;
    if (list) list.hidden = true;
    board.hidden = false;
    board.innerHTML = '';
    for (const st of TOPIC_STATUSES) {
      const lane = document.createElement('div');
      lane.className = 'kanban-lane';
      lane.dataset.status = st.value;
      const head = document.createElement('div');
      head.className = 'kanban-lane-head';
      const title = document.createElement('div');
      title.className = 'kanban-lane-title';
      const dot = document.createElement('span');
      dot.className = `kanban-lane-dot is-${st.value}`;
      title.append(dot, document.createTextNode(st.label));
      const count = document.createElement('span');
      count.className = 'kanban-lane-count';
      const laneItems = items.filter(t => t.status === st.value);
      count.textContent = laneItems.length;
      head.append(title, count);
      lane.appendChild(head);
      const body = document.createElement('div');
      body.className = 'kanban-lane-body';
      body.dataset.status = st.value;
      attachLaneDnD(body);
      for (const t of laneItems) body.appendChild(buildTopicCard(t));
      lane.appendChild(body);
      board.appendChild(lane);
    }
  }

  function renderTopicListTable(items) {
    const board = $('#kanban-board');
    const list = $('#topic-list-wrap');
    if (!list) return;
    if (board) board.hidden = true;
    list.hidden = false;
    const tbody = $('#topic-list-body');
    const empty = $('#topic-list-empty');
    tbody.innerHTML = '';
    if (!items.length) {
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    items.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    for (const t of items) {
      const tr = document.createElement('tr');
      tr.dataset.slug = t.slug;
      const titleCell = document.createElement('td');
      titleCell.className = 'topic-list-title';
      titleCell.textContent = t.title;
      titleCell.title = t.title;
      const statusCell = document.createElement('td');
      const statusEl = document.createElement('span');
      const sm = statusMeta(t.status);
      statusEl.className = `topic-list-status is-${t.status}`;
      statusEl.textContent = sm.label;
      statusCell.appendChild(statusEl);
      const prioCell = document.createElement('td');
      const prioEl = document.createElement('span');
      prioEl.className = `topic-priority is-${t.priority}`;
      prioEl.textContent = t.priority;
      prioCell.appendChild(prioEl);
      const sourceCell = document.createElement('td');
      sourceCell.className = 'topic-list-source';
      sourceCell.textContent = t.source || '—';
      sourceCell.title = t.source || '';
      const linkCell = document.createElement('td');
      if (t.linkedArticle) {
        const a = document.createElement('a');
        a.href = '#';
        a.className = 'topic-linked';
        a.textContent = `📄 ${t.linkedArticle}`;
        a.title = `跳转到文章: ${t.linkedArticle}`;
        a.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          jumpToArticle(t.linkedArticle);
        });
        linkCell.appendChild(a);
      } else {
        linkCell.textContent = '—';
        linkCell.style.color = 'var(--fg-muted)';
      }
      const dateCell = document.createElement('td');
      dateCell.textContent = t.updatedAt ? formatDate(t.updatedAt) : '—';
      const actionsCell = document.createElement('td');
      const actions = document.createElement('div');
      actions.className = 'topic-list-actions';
      const editBtn = document.createElement('button');
      editBtn.className = 'topic-card-action';
      editBtn.textContent = '编辑';
      editBtn.title = '编辑选题';
      editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTopicModal(t); });
      const articleBtn = document.createElement('button');
      articleBtn.className = 'topic-card-action';
      articleBtn.textContent = '建文章';
      articleBtn.title = '从选题创建文章';
      articleBtn.addEventListener('click', (e) => { e.stopPropagation(); createArticleFromTopic(t); });
      const delBtn = document.createElement('button');
      delBtn.className = 'topic-card-action';
      delBtn.textContent = '删除';
      delBtn.title = '删除选题';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        confirmDialog(`确定删除选题「${t.title}」？此操作不可撤销。`, { title: '删除选题', danger: true, okText: '删除' })
          .then(ok => { if (ok) deleteTopic(t); });
      });
      actions.append(editBtn, articleBtn, delBtn);
      actionsCell.appendChild(actions);
      tr.append(titleCell, statusCell, prioCell, sourceCell, linkCell, dateCell, actionsCell);
      tr.addEventListener('click', () => openTopicModal(t));
      tbody.appendChild(tr);
    }
  }

  function buildTopicCard(topic) {
    const card = document.createElement('div');
    card.className = 'topic-card';
    card.draggable = true;
    card.dataset.slug = topic.slug;
    const title = document.createElement('div');
    title.className = 'topic-card-title';
    title.textContent = topic.title;
    card.appendChild(title);
    if (topic.summary) {
      const summary = document.createElement('div');
      summary.className = 'topic-card-summary';
      summary.textContent = topic.summary;
      card.appendChild(summary);
    }
    const meta = document.createElement('div');
    meta.className = 'topic-card-meta';
    const prio = document.createElement('span');
    prio.className = `topic-priority is-${topic.priority}`;
    prio.textContent = topic.priority;
    meta.appendChild(prio);
    if (topic.source) {
      const src = document.createElement('span');
      src.className = 'topic-card-source';
      src.textContent = `🔗 ${topic.source}`;
      src.title = topic.source;
      meta.appendChild(src);
    }
    if (topic.linkedArticle) {
      const link = document.createElement('a');
      link.className = 'topic-linked';
      link.href = '#';
      link.textContent = `📄 ${topic.linkedArticle}`;
      link.title = `跳转到文章: ${topic.linkedArticle}`;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        jumpToArticle(topic.linkedArticle);
      });
      meta.appendChild(link);
    }
    card.appendChild(meta);
    const foot = document.createElement('div');
    foot.className = 'topic-card-foot';
    const updated = document.createElement('span');
    updated.textContent = topic.updatedAt ? formatDate(topic.updatedAt) : '';
    foot.appendChild(updated);
    const actions = document.createElement('div');
    actions.className = 'topic-card-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'topic-card-action';
    editBtn.textContent = '✎';
    editBtn.title = '编辑';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); openTopicModal(topic); });
    const articleBtn = document.createElement('button');
    articleBtn.className = 'topic-card-action';
    articleBtn.textContent = '📄';
    articleBtn.title = '从选题创建文章';
    articleBtn.addEventListener('click', (e) => { e.stopPropagation(); createArticleFromTopic(topic); });
    const delBtn = document.createElement('button');
    delBtn.className = 'topic-card-action';
    delBtn.textContent = '🗑';
    delBtn.title = '删除';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDialog(`确定删除选题「${topic.title}」？此操作不可撤销。`, { title: '删除选题', danger: true, okText: '删除' })
        .then(ok => { if (ok) deleteTopic(topic); });
    });
    actions.append(editBtn, articleBtn, delBtn);
    foot.appendChild(actions);
    card.appendChild(foot);
    card.addEventListener('dblclick', () => openTopicModal(topic));
    attachCardDnD(card);
    return card;
  }

  // === Drag and drop ===
  function attachCardDnD(card) {
    card.addEventListener('dragstart', (e) => {
      state.drag = { slug: card.dataset.slug, fromStatus: card.parentElement?.dataset.status || '' };
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', card.dataset.slug); } catch (err) { /* ignore */ }
      requestAnimationFrame(() => card.classList.add('is-dragging'));
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('is-dragging');
      state.drag = null;
      $$('.kanban-lane.is-drop-target').forEach(el => el.classList.remove('is-drop-target'));
    });
  }

  function attachLaneDnD(lane) {
    lane.addEventListener('dragover', (e) => {
      if (!state.drag) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      lane.classList.add('is-drop-target');
    });
    lane.addEventListener('dragleave', (e) => {
      if (e.target === lane) lane.classList.remove('is-drop-target');
    });
    lane.addEventListener('drop', async (e) => {
      e.preventDefault();
      lane.classList.remove('is-drop-target');
      const slug = state.drag?.slug || (e.dataTransfer && e.dataTransfer.getData('text/plain'));
      if (!slug) return;
      const newStatus = lane.dataset.status;
      const topic = state.topicsBySlug.get(slug);
      if (!topic) return;
      if (topic.status === newStatus) return;
      try {
        const updated = await api.updateTopic(slug, { status: newStatus });
        state.topicsBySlug.set(slug, { ...topic, status: newStatus, updatedAt: updated.updatedAt || new Date().toISOString() });
        const idx = state.topics.findIndex(t => t.slug === slug);
        if (idx >= 0) state.topics[idx] = { ...state.topics[idx], status: newStatus, updatedAt: updated.updatedAt || new Date().toISOString() };
        renderBoard();
        toast(`已切换状态: ${statusMeta(newStatus).label}`, 'success');
      } catch (err) {
        toast(`更新状态失败: ${err.message}`, 'error');
      }
    });
  }

  // === Topic modal (create / edit) ===
  function openTopicModal(topic) {
    const isEdit = !!topic;
    const body = document.createElement('div');

    const titleRow = document.createElement('div');
    titleRow.className = 'form-row';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = '标题';
    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.value = topic?.title || '';
    titleInput.placeholder = '一句话讲清楚这个选题';
    titleInput.required = true;
    titleRow.append(titleLabel, titleInput);
    body.appendChild(titleRow);

    const summaryRow = document.createElement('div');
    summaryRow.className = 'form-row';
    const summaryLabel = document.createElement('label');
    summaryLabel.textContent = '摘要';
    const summaryInput = document.createElement('textarea');
    summaryInput.className = 'is-summary';
    summaryInput.placeholder = '两三句话说明核心观点或读者价值';
    summaryInput.value = topic?.summary || '';
    summaryRow.append(summaryLabel, summaryInput);
    body.appendChild(summaryRow);

    const sourceRow = document.createElement('div');
    sourceRow.className = 'form-row';
    const sourceLabel = document.createElement('label');
    sourceLabel.textContent = '来源（可选）';
    const sourceInput = document.createElement('input');
    sourceInput.type = 'text';
    sourceInput.placeholder = '例: 公众号「XXX」2026-05 文章 / Twitter @xxx';
    sourceInput.value = topic?.source || '';
    sourceRow.append(sourceLabel, sourceInput);
    body.appendChild(sourceRow);

    const inlineRow = document.createElement('div');
    inlineRow.className = 'form-row is-inline';
    const statusWrap = document.createElement('div');
    const statusLabel = document.createElement('label');
    statusLabel.textContent = '状态';
    const statusSelect = document.createElement('select');
    for (const s of TOPIC_STATUSES) {
      const opt = document.createElement('option');
      opt.value = s.value;
      opt.textContent = s.label;
      if ((topic?.status || 'idea') === s.value) opt.selected = true;
      statusSelect.appendChild(opt);
    }
    statusWrap.append(statusLabel, statusSelect);
    const prioWrap = document.createElement('div');
    const prioLabel = document.createElement('label');
    prioLabel.textContent = '优先级';
    const prioSelect = document.createElement('select');
    for (const p of TOPIC_PRIORITIES) {
      const opt = document.createElement('option');
      opt.value = p.value;
      opt.textContent = p.label;
      if ((topic?.priority || 'P2') === p.value) opt.selected = true;
      prioSelect.appendChild(opt);
    }
    prioWrap.append(prioLabel, prioSelect);
    inlineRow.append(statusWrap, prioWrap);
    body.appendChild(inlineRow);

    const linkRow = document.createElement('div');
    linkRow.className = 'form-row';
    const linkLabel = document.createElement('label');
    linkLabel.textContent = '关联文章 slug（可选）';
    const linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.placeholder = '例如 my-first-post';
    linkInput.value = topic?.linkedArticle || '';
    linkRow.append(linkLabel, linkInput);
    body.appendChild(linkRow);

    const helper = document.createElement('div');
    helper.className = 'form-helper';
    helper.textContent = '提示：拖拽卡片可快速切换「状态」；双击卡片或点击「✎」可重新打开此面板。';
    body.appendChild(helper);

    const foot = document.createElement('div');
    foot.style.display = 'flex';
    foot.style.gap = '8px';
    if (isEdit) {
      const createArticleBtn = document.createElement('button');
      createArticleBtn.className = 'btn btn-accent';
      createArticleBtn.textContent = '📄 从选题创建文章';
      createArticleBtn.addEventListener('click', async () => {
        p.close('create-article');
      });
      foot.appendChild(createArticleBtn);
    }
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn';
    cancelBtn.textContent = '取消';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary';
    saveBtn.textContent = isEdit ? '保存' : '创建';
    foot.append(cancelBtn, saveBtn);

    const p = modal({ title: isEdit ? '编辑选题' : '新建选题', body, footer: foot, width: '560px' });
    setTimeout(() => titleInput.focus(), 0);

    cancelBtn.onclick = () => p.close(null);
    saveBtn.onclick = async () => {
      const titleVal = titleInput.value.trim();
      if (!titleVal) {
        toast('请填写标题', 'warn');
        titleInput.focus();
        return;
      }
      const payload = {
        title: titleVal,
        summary: summaryInput.value.trim(),
        source: sourceInput.value.trim(),
        status: statusSelect.value,
        priority: prioSelect.value,
        linkedArticle: linkInput.value.trim()
      };
      saveBtn.disabled = true;
      saveBtn.classList.add('chip-loading');
      try {
        if (isEdit) {
          await api.updateTopic(topic.slug, payload);
          toast('选题已更新', 'success');
        } else {
          await api.createTopic(payload);
          toast('选题已创建', 'success');
        }
        p.close('saved');
        await refreshTopicList();
      } catch (err) {
        toast(`${isEdit ? '更新' : '创建'}失败: ${err.message}`, 'error');
      } finally {
        saveBtn.disabled = false;
        saveBtn.classList.remove('chip-loading');
      }
    };
    p.then(async (result) => {
      if (result === 'create-article' && isEdit) {
        await refreshTopicList();
        const fresh = state.topicsBySlug.get(topic.slug) || topic;
        createArticleFromTopic(fresh);
      }
    });
  }

  async function deleteTopic(topic) {
    try {
      await api.deleteTopic(topic.slug);
      state.topics = state.topics.filter(t => t.slug !== topic.slug);
      state.topicsBySlug.delete(topic.slug);
      renderBoard();
      toast('选题已删除', 'success');
    } catch (err) {
      toast(`删除失败: ${err.message}`, 'error');
    }
  }

  function jumpToArticle(slug) {
    if (!slug) return;
    setActiveView('articles');
    state.articlesBySlug = state.articlesBySlug || new Map();
    if (!state.articlesBySlug.has(slug)) {
      toast(`文章 ${slug} 不在当前列表`, 'warn');
      return;
    }
    selectArticle(slug);
  }

  function buildArticleFromTopic(topic) {
    const title = topic.title || '未命名';
    const lines = [];
    lines.push(`# ${title}`);
    lines.push('');
    if (topic.summary) {
      const sumLines = String(topic.summary).split(/\r?\n/);
      for (const line of sumLines) {
        lines.push(`> ${line}`);
      }
      lines.push('');
    }
    if (topic.source) {
      lines.push(`> 来源：${topic.source}`);
      lines.push('');
    }
    lines.push('## 正文');
    lines.push('');
    lines.push('（在此处展开内容…）');
    lines.push('');
    if (topic.source) {
      lines.push('---');
      lines.push(`*本文选题来源：${topic.source}*`);
    }
    return lines.join('\n');
  }

  async function createArticleFromTopic(topic) {
    if (!topic) return;
    if (state.dirty && state.activeArticle) {
      try { await flushSave(); } catch (err) { /* ignore */ }
    }
    const content = buildArticleFromTopic(topic);
    const title = topic.title || '未命名';
    try {
      const result = await api.createArticle({
        title,
        author: '',
        content,
        tags: [],
        status: 'draft'
      });
      if (result && result.slug) {
        try {
          await api.updateTopic(topic.slug, { linkedArticle: result.slug });
          const idx = state.topics.findIndex(t => t.slug === topic.slug);
          if (idx >= 0) state.topics[idx] = { ...state.topics[idx], linkedArticle: result.slug };
          state.topicsBySlug.set(topic.slug, { ...(state.topicsBySlug.get(topic.slug) || topic), linkedArticle: result.slug });
        } catch (linkErr) {
          console.warn('link topic to article failed', linkErr);
        }
        await refreshArticleList();
        setActiveView('articles');
        await selectArticle(result.slug);
        toast(`已从选题「${topic.title}」创建文章`, 'success');
      }
    } catch (err) {
      toast(`创建文章失败: ${err.message}`, 'error');
    }
  }

  function bindTopicEvents() {
    const navArticles = $('#nav-articles');
    const navTopics = $('#nav-topics');
    if (navArticles) navArticles.addEventListener('click', () => setActiveView('articles'));
    if (navTopics) navTopics.addEventListener('click', () => setActiveView('topics'));

    const newTopicBtn = $('#btn-new-topic');
    if (newTopicBtn) newTopicBtn.addEventListener('click', () => openTopicModal(null));

    $$('.view-switch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const v = btn.dataset.boardView;
        if (!v) return;
        state.boardView = v;
        $$('.view-switch-btn').forEach(b => {
          const active = b.dataset.boardView === v;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        renderBoard();
      });
    });

    const search = $('#topic-search');
    if (search) search.addEventListener('input', (e) => {
      state.topicSearch = e.target.value;
      renderBoard();
    });
  }


  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
