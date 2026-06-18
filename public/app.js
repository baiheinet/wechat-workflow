(function () {
  'use strict';
  const $ = window.WW.$;
  const $$ = window.WW.$$;
  const api = window.WW.api;

  const state = window.WW._state = {
    articles: [],
    articlesBySlug: new Map(),
    topics: [],
    topicsBySlug: new Map(),
    activeSlug: null,
    activeTopicSlug: null,
    activeArticle: null,
    chatMessages: [],
    templates: [],
    template: localStorage.getItem('ww.template') || 'minimal',
    darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches
  };

  window.WW.toast = toast;

  function toast(message, type, duration) {
    type = type || 'info';
    duration = duration || 3000;
    const root = $('#toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast is-' + type;
    el.textContent = message;
    root.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, duration);
  }

  async function init() {
    state.darkMode = localStorage.getItem('ww.dark') === 'true' ||
      (localStorage.getItem('ww.dark') === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
    applyTheme();

    window.WW.tree.init(state);
    window.WW.editor.init(state);
    window.WW.chat.init(state);

    state.onSelectArticle = selectArticle;
    state.onSelectTopic = selectTopic;
    state.onNewArticle = newArticle;
    state.onNewTopic = newTopic;

    bindGlobal();
    updateHealth();

    Promise.all([
      api.listArticles().catch(() => []),
      api.listTopics().catch(() => []),
      api.listTemplates().catch(() => [])
    ]).then(([articles, topics, templates]) => {
      state.articles = articles;
      state.articlesBySlug = new Map(articles.map(a => [a.slug, a]));
      state.topics = topics;
      state.topicsBySlug = new Map(topics.map(t => [t.slug, t]));
      state.templates = templates || [];
      renderTemplateSelect();
      window.WW.tree.render();
      if (articles.length > 0) {
        selectArticle(articles[0].slug);
      } else {
        seedSampleArticle();
      }
    }).catch(err => {
      $('#doc-title').textContent = '连接失败';
      toast('后端连接失败: ' + err.message, 'error', 5000);
    });
  }

  async function selectArticle(slug) {
    if (state.activeSlug === slug) return;
    await window.WW.editor.flushSave();

    state.activeSlug = slug;
    state.activeTopicSlug = null;
    window.WW.tree.selectArticle(slug);
    $('#doc-title').textContent = state.articlesBySlug.get(slug)?.title || '';

    try {
      const article = await api.getArticle(slug);
      state.activeArticle = article;
      window.WW.editor.loadArticle(article);
      window.WW.chat.loadHistory();
    } catch (err) {
      toast('加载文章失败: ' + err.message, 'error');
    }
  }

  function selectTopic(slug) {
    state.activeTopicSlug = slug;
    state.activeSlug = null;
    window.WW.tree.selectTopic(slug);
    const topic = state.topicsBySlug.get(slug);
    if (!topic) return;
    $('#doc-title').textContent = topic.title || '';
    window.WW.editor.loadArticle({
      title: topic.title || '',
      content: (topic.summary ? '> ' + topic.summary + '\n\n' : '') + (topic.content || ''),
      slug: topic.slug
    });
  }

  async function newArticle() {
    await window.WW.editor.flushSave();
    try {
      const result = await api.createArticle({
        title: '新文章',
        author: '',
        content: '# 新文章\n\n',
        tags: [],
        status: 'draft'
      });
      if (result && result.slug) {
        const articles = await api.listArticles();
        state.articles = articles;
        state.articlesBySlug = new Map(articles.map(a => [a.slug, a]));
        window.WW.tree.render();
        await selectArticle(result.slug);
        $('#editor-title').focus();
        toast('已创建新文章', 'success');
      }
    } catch (err) {
      toast('创建文章失败: ' + err.message, 'error');
    }
  }

  async function newTopic() {
    const title = prompt('选题标题：');
    if (!title) return;
    try {
      const result = await api.createTopic({ title, summary: '', source: '', status: 'idea', priority: 'P2' });
      if (result && result.slug) {
        const topics = await api.listTopics();
        state.topics = topics;
        state.topicsBySlug = new Map(topics.map(t => [t.slug, t]));
        window.WW.tree.render();
        toast('已创建选题', 'success');
      }
    } catch (err) {
      toast('创建选题失败: ' + err.message, 'error');
    }
  }

  async function publishCurrent() {
    if (!state.activeSlug) { toast('请先选择一篇文章', 'warn'); return; }
    await window.WW.editor.flushSave();
    try {
      const result = await api.publish({ slug: state.activeSlug, template: state.template });
      toast('发布成功: ' + (result.mode || 'ok'), 'success');
    } catch (err) {
      toast('发布失败: ' + err.message, 'error');
    }
  }

  async function exportCurrent() {
    if (!state.activeSlug) { toast('请先选择一篇文章', 'warn'); return; }
    await window.WW.editor.flushSave();
    try {
      const result = await api.convert({ slug: state.activeSlug, template: state.template });
      toast('导出成功: ' + result.path, 'success');
    } catch (err) {
      toast('导出失败: ' + err.message, 'error');
    }
  }

  function toggleDark() {
    state.darkMode = !state.darkMode;
    localStorage.setItem('ww.dark', state.darkMode ? 'true' : 'false');
    applyTheme();
  }

  function renderTemplateSelect() {
    const sel = $('#template-select');
    if (!sel) return;
    sel.innerHTML = '';
    for (const t of state.templates) {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = `${t.name} — ${t.label || t.name}`;
      if (t.name === state.template) opt.selected = true;
      sel.appendChild(opt);
    }
  }

  function applyTheme() {
    document.documentElement.classList.toggle('dark', state.darkMode);
    const btn = $('#dark-toggle');
    if (btn) btn.textContent = state.darkMode ? '☀️' : '🌙';
  }

  async function updateHealth() {
    try {
      const h = await api.health();
      const dot = $('#health-dot');
      const text = $('#health-text');
      if (dot) dot.className = 'status-dot is-ok';
      if (text) text.textContent = h?.wechatConfigured ? '已连接' : '已连接（微信未配置）';
    } catch (err) {
      const dot = $('#health-dot');
      if (dot) dot.className = 'status-dot is-down';
      const text = $('#health-text');
      if (text) text.textContent = '连接断开';
    }
  }

  function bindGlobal() {
    const publishBtn = $('#btn-publish');
    const exportBtn = $('#btn-convert');
    const darkToggle = $('#dark-toggle');
    const settingsBtn = $('#btn-settings');
    const tplSelect = $('#template-select');
    const settingsModal = $('#settings-modal');
    const settingsClose = settingsModal ? settingsModal.querySelector('.modal-close') : null;

    if (publishBtn) publishBtn.addEventListener('click', publishCurrent);
    if (exportBtn) exportBtn.addEventListener('click', exportCurrent);
    if (darkToggle) darkToggle.addEventListener('click', toggleDark);
    if (tplSelect) tplSelect.addEventListener('change', (e) => {
      state.template = e.target.value;
      localStorage.setItem('ww.template', state.template);
      toast(`已切换模板：${state.template}`, 'success', 1500);
    });

    if (settingsBtn) settingsBtn.addEventListener('click', () => {
      if (settingsModal) settingsModal.classList.add('is-open');
    });
    if (settingsClose) settingsClose.addEventListener('click', () => {
      if (settingsModal) settingsModal.classList.remove('is-open');
    });
    if (settingsModal) settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal) settingsModal.classList.remove('is-open');
    });

    // Keyboard shortcut: Ctrl+S to save
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        window.WW.editor.flushSave().then(() => toast('已保存'));
      }
    });
  }

  const SAMPLE_BODY = '# 欢迎使用 WeChat Workflow\n\n这是一篇**示例文章**，演示了 Markdown 转微信公众号样式的核心排版能力。\n\n## 文本样式\n\n普通段落，用于测试基础排版。**加粗** 和 *斜体* 以及 ~~删除线~~。\n\n> 这是引用块，用于突出某段重要文字。\n\n## 列表\n\n- 无序项 1\n- 无序项 2\n- 无序项 3\n\n1. 有序第一步\n2. 有序第二步\n3. 有序第三步\n\n## 代码\n\n行内 `const x = 1`。\n\n```\nfunction hello() {\n  console.log("Hello!");\n}\n```\n\n试着编辑这篇内容，或者点文档树中的「+ 新建文章」开始写自己的稿子吧。';

  async function seedSampleArticle() {
    try {
      await api.createArticle({
        title: '欢迎使用 WeChat Workflow',
        author: 'Multica',
        content: SAMPLE_BODY,
        tags: ['welcome'],
        status: 'draft'
      });
      const articles = await api.listArticles();
      state.articles = articles;
      state.articlesBySlug = new Map(articles.map(a => [a.slug, a]));
      window.WW.tree.render();
      if (articles.length > 0) selectArticle(articles[0].slug);
    } catch (err) {
      console.warn('seed sample failed', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
