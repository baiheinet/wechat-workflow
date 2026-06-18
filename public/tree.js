(function () {
  'use strict';
  const $ = window.WW.$;
  const $$ = window.WW.$$;
  const api = window.WW.api;

  let state = null;

  function init(appState) {
    state = appState;
    render();
    bind();
  }

  function render() {
    const el = $('#doc-tree');
    if (!el) return;

    const articles = state.articles || [];
    const topics = state.topics || [];
    const activeSlug = state.activeSlug;

    let html = '<div class="tree-section"><div class="tree-section-head">文章</div>';
    if (articles.length === 0) {
      html += '<div class="tree-empty">暂无文章</div>';
    } else {
      html += articles.map(a => {
        const active = a.slug === activeSlug ? ' tree-item-active' : '';
        const statusLabel = { draft: '草稿', ready: '已转换', published: '已发布' }[a.status] || a.status;
        return `<div class="tree-item${active}" data-type="article" data-slug="${a.slug}">
          <span class="tree-item-title">${esc(a.title)}</span>
          <span class="tree-item-meta">${statusLabel}</span>
        </div>`;
      }).join('');
    }
    html += '<div class="tree-action" data-action="new-article">+ 新建文章</div>';
    html += '</div>';

    html += '<div class="tree-section"><div class="tree-section-head">选题</div>';
    if (topics.length === 0) {
      html += '<div class="tree-empty">暂无选题</div>';
    } else {
      html += topics.map(t => {
        const active = t.slug === state.activeTopicSlug ? ' tree-item-active' : '';
        return `<div class="tree-item${active}" data-type="topic" data-slug="${t.slug}">
          <span class="tree-item-title">${esc(t.title)}</span>
          <span class="tree-item-meta">${esc(t.status || '')}</span>
        </div>`;
      }).join('');
    }
    html += '<div class="tree-action" data-action="new-topic">+ 新建选题</div>';
    html += '</div>';

    el.innerHTML = html;
  }

  function bind() {
    const el = $('#doc-tree');
    if (!el) return;
    el.addEventListener('click', (e) => {
      const item = e.target.closest('.tree-item');
      if (item) {
        const type = item.dataset.type;
        const slug = item.dataset.slug;
        if (type === 'article' && state.onSelectArticle) state.onSelectArticle(slug);
        if (type === 'topic' && state.onSelectTopic) state.onSelectTopic(slug);
        return;
      }
      const action = e.target.closest('[data-action]');
      if (!action) return;
      const act = action.dataset.action;
      if (act === 'new-article' && state.onNewArticle) state.onNewArticle();
      if (act === 'new-topic' && state.onNewTopic) state.onNewTopic();
    });
  }

  function selectArticle(slug) {
    state.activeSlug = slug;
    state.activeTopicSlug = null;
    render();
  }

  function selectTopic(slug) {
    state.activeTopicSlug = slug;
    state.activeSlug = null;
    render();
  }

  function esc(s) {
    const d = document.createElement('div');
    d.textContent = String(s);
    return d.innerHTML;
  }

  window.WW = window.WW || {};
  window.WW.tree = { init, render, selectArticle, selectTopic };
})();
