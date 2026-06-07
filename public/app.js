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
    lastSavedAt: null
  };

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
    generateImage(payload) { return this._fetch('/api/generate-image', { method: 'POST', body: JSON.stringify(payload) }); }
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
    return new Promise((resolve) => {
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
      node.addEventListener('click', (e) => {
        if (e.target === node) close(null);
        if (e.target.closest('[data-action="close"]')) close(null);
      });
      const escHandler = (e) => {
        if (e.key === 'Escape') { close(null); document.removeEventListener('keydown', escHandler); }
      };
      document.addEventListener('keydown', escHandler);
      root.appendChild(node);

      function close(value) {
        node.remove();
        document.removeEventListener('keydown', escHandler);
        resolve(value);
      }
      return { close, root: node };
    });
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
    const dot = $('#status-dot');
    const t = $('#status-text');
    dot.classList.remove('is-ok', 'is-down');
    if (kind === 'ok') dot.classList.add('is-ok');
    else if (kind === 'down') dot.classList.add('is-down');
    t.textContent = text;
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
        } else {
          insertMarkdown(action);
        }
      });
    });

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
        doRender();
      }
    }).catch(err => {
      console.error('init failed', err);
      setStatus('down', '后端连接失败');
      toast(`后端连接失败: ${err.message}`, 'error', 5000);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
