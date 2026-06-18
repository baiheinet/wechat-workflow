(function () {
  'use strict';
  const $ = window.WW.$;
  const api = window.WW.api;

  let state = null;
  let saveTimer = null;
  let dirty = false;

  function init(appState) {
    state = appState;
    bind();
  }

  function loadArticle(article) {
    if (!article) {
      $('#editor-title').value = '';
      $('#editor-content').innerHTML = '';
      $('#editor-status').textContent = '未选中文章';
      return;
    }
    $('#editor-title').value = article.title || '';
    $('#editor-status').textContent = article.slug;
    renderWithTemplate(article.content || '');
    dirty = false;
  }

  async function renderWithTemplate(md) {
    const tpl = (state && state.template) || 'minimal';
    try {
      const result = await api.render({ content: md, template: tpl, mode: 'editor' });
      if (result && result.html) {
        $('#editor-content').innerHTML = result.html;
        applyTemplateCss(result.css || '');
        return;
      }
    } catch (err) { /* fall through */ }
    $('#editor-content').innerHTML = mdToHtml(md);
  }

  function applyTemplateCss(css) {
    let style = document.getElementById('editor-template-css');
    if (!style) {
      style = document.createElement('style');
      style.id = 'editor-template-css';
      document.head.appendChild(style);
    }
    style.textContent = css;
  }

  async function reRender() {
    const html = $('#editor-content').innerHTML;
    const md = htmlToMd(html);
    await renderWithTemplate(md);
  }

  function getContent() {
    const el = $('#editor-content');
    const clone = el.cloneNode(true);
    clone.querySelectorAll('[style]').forEach(n => n.removeAttribute('style'));
    return htmlToMd(clone.innerHTML);
  }

  function markDirty() {
    if (!dirty) { dirty = true; }
    scheduleSave();
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(doSave, 1500);
  }

  async function doSave() {
    if (!dirty) return;
    if (!state.activeSlug) return;
    dirty = false;
    const title = $('#editor-title').value.trim() || '无标题';
    const content = getContent();
    try {
      await api.updateArticle(state.activeSlug, { title, content });
    } catch (err) {
      console.warn('save failed', err);
      dirty = true;
    }
  }

  async function flushSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (dirty) await doSave();
  }

  function bind() {
    const titleInput = $('#editor-title');
    const contentEd = $('#editor-content');

    if (titleInput) {
      titleInput.addEventListener('input', markDirty);
    }
    if (contentEd) {
      contentEd.addEventListener('input', markDirty);
      contentEd.addEventListener('keydown', (e) => {
        if (e.key === 'Tab') {
          e.preventDefault();
          document.execCommand('insertHTML', false, '  ');
        }
      });
      contentEd.addEventListener('mouseup', showFloatingToolbar);
      contentEd.addEventListener('keyup', showFloatingToolbar);
    }

    document.addEventListener('click', (e) => {
      const ft = $('#float-toolbar');
      if (ft && !e.target.closest('#float-toolbar') && !e.target.closest('#editor-content')) {
        ft.classList.add('hidden');
      }
    });
  }

  function showFloatingToolbar() {
    const sel = window.getSelection();
    const ft = $('#float-toolbar');
    if (!ft) return;
    if (!sel || sel.isCollapsed || !sel.rangeCount) {
      ft.classList.add('hidden');
      return;
    }
    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const editorRect = $('#editor-content').getBoundingClientRect();

    ft.style.left = Math.max(0, rect.left + rect.width / 2 - ft.offsetWidth / 2) + 'px';
    ft.style.top = (rect.top - 44) + 'px';
    ft.classList.remove('hidden');
  }

  function execFormat(cmd, val) {
    document.execCommand(cmd, false, val || null);
    $('#editor-content').focus();
    markDirty();
  }

  function insertImage(url) {
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      const range = sel.getRangeAt(0);
      const fig = document.createElement('figure');
      fig.className = 'editor-figure';
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'generated';
      fig.appendChild(img);
      range.deleteContents();
      range.insertNode(fig);
    } else {
      document.execCommand('insertHTML', false, `<figure class="editor-figure"><img src="${url}" alt="generated"></figure>`);
    }
    markDirty();
  }

  async function aiRewrite() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;
    const text = sel.toString().trim();
    if (!text) return;

    const ft = $('#float-toolbar');
    if (ft) ft.classList.add('hidden');

    try {
      const result = await api.chatPolish(text);
      if (result && result.result) {
        document.execCommand('insertText', false, result.result);
        markDirty();
      }
    } catch (err) {
      window.WW.toast?.('AI 润色失败: ' + err.message, 'error');
    }
  }

  async function insertAIImage() {
    const sel = window.getSelection();
    const text = sel && !sel.isCollapsed ? sel.toString().trim() : '';
    const title = $('#editor-title').value || 'illustration';
    const prompt = text || title;

    const ft = $('#float-toolbar');
    if (ft) ft.classList.add('hidden');

    try {
      window.WW.toast?.('生成图片中…', 'info');
      const result = await api.generateImage({ type: 'inline', description: prompt, title });
      if (result && result.url) {
        insertImage(result.url);
        window.WW.toast?.('图片已插入', 'success');
      }
    } catch (err) {
      window.WW.toast?.('图片生成失败: ' + err.message, 'error');
    }
  }

  function mdToHtml(md) {
    if (!md) return '';
    let h = md
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/~~(.+?)~~/g, '<del>$1</del>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<figure class="editor-figure"><img src="$2" alt="$1"></figure>')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li value="$1">$2</li>');

    const lines = h.split('\n');
    let out = [];
    let inLi = false;
    let inBlockquote = false;

    for (const line of lines) {
      if (line.startsWith('<li') || line.startsWith('<h') || line.startsWith('<blockquote') || line.startsWith('<figure')) {
        if (inLi && !line.startsWith('<li')) { out.push('</ul>'); inLi = false; }
        if (inBlockquote && !line.startsWith('<blockquote')) { out.push('</blockquote>'); inBlockquote = false; }
        out.push(line);
        if (line.startsWith('<li')) { if (!inLi) { out.splice(out.length-1, 0, '<ul>'); inLi = true; } }
        if (line.startsWith('<blockquote')) inBlockquote = true;
        continue;
      }
      if (inLi) { out.push('</ul>'); inLi = false; }
      if (inBlockquote) { out.push('</blockquote>'); inBlockquote = false; }
      if (line.trim()) {
        if (line.startsWith('<h')) { out.push(line); }
        else { out.push('<p>' + line + '</p>'); }
      }
    }
    if (inLi) out.push('</ul>');
    if (inBlockquote) out.push('</blockquote>');

    return out.join('\n');
  }

  function htmlToMd(html) {
    if (!html) return '';
    let s = html;
    s = s.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
    s = s.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
    s = s.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
    s = s.replace(/<strong>(.*?)<\/strong>/gi, '**$1**');
    s = s.replace(/<em>(.*?)<\/em>/gi, '*$1*');
    s = s.replace(/<del>(.*?)<\/del>/gi, '~~$1~~');
    s = s.replace(/<code>(.*?)<\/code>/gi, '`$1`');
    s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    s = s.replace(/<figure[^>]*>.*?<img[^>]*src="([^"]*)"[^>]*>.*?<\/figure>/gi, '![image]($1)');
    s = s.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, '![image]($1)');
    s = s.replace(/<blockquote[^>]*>(.*?)<\/blockquote>/gis, (m, c) => {
      return c.replace(/<p>(.*?)<\/p>/g, '> $1\n').replace(/<br\s*\/?>/g, '\n> ') + '\n';
    });
    s = s.replace(/<\/li>/gi, '\n');
    s = s.replace(/<li[^>]*>/gi, '- ');
    s = s.replace(/<\/?ul>/gi, '');
    s = s.replace(/<\/?ol>/gi, '');
    s = s.replace(/<p[^>]*>/gi, '');
    s = s.replace(/<\/p>/gi, '\n\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/&amp;/g, '&');
    s = s.replace(/&lt;/g, '<');
    s = s.replace(/&gt;/g, '>');
    s = s.replace(/&quot;/g, '"');
    s = s.replace(/\n{3,}/g, '\n\n');
    s = s.replace(/<div[^>]*>/gi, '');
    s = s.replace(/<\/div>/gi, '\n');
    s = s.replace(/<[^>]+>/g, '');
    return s.trim();
  }

  window.WW = window.WW || {};
  window.WW.editor = { init, loadArticle, getContent, flushSave, markDirty, execFormat, insertImage, aiRewrite, insertAIImage, htmlToMd, mdToHtml, reRender };
})();
