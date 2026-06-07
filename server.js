const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = require('fs/promises');

const ROOT = __dirname;
const DATA_DIR = process.env.VERCEL ? '/tmp/wechat-workflow' : ROOT;
if (process.env.VERCEL) process.env.DATA_DIR = DATA_DIR;

const matter = require('gray-matter');
const { render } = require('./scripts/lib/markdownToHtml');
const { handleImages } = require('./scripts/lib/imageHandler');
const { listTemplates } = require('./scripts/lib/templateLoader');
const { generateCover, generateInline, getApiKey } = require('./scripts/lib/imageGen');
const wechatApi = require('./scripts/lib/wechatApi');
const blobStorage = require('./scripts/lib/blobStorage');
const DATA_SRC = ROOT;
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const CONFIG_SRC = path.join(DATA_SRC, 'config.json');
const DRAFTS_DIR = path.join(DATA_DIR, 'articles', 'drafts');
const DRAFTS_SRC = path.join(DATA_SRC, 'articles', 'drafts');
const READY_DIR = path.join(DATA_DIR, 'articles', 'ready');
const PUBLISHED_DIR = path.join(DATA_DIR, 'articles', 'published');
const PUBLIC_DIR = path.join(ROOT, 'public');

function ensureDataDirs() {
  fs.mkdirSync(DRAFTS_DIR, { recursive: true });
  fs.mkdirSync(READY_DIR, { recursive: true });
  fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
}

function bootstrapData() {
  ensureDataDirs();
  if (DATA_DIR !== ROOT) {
    if (!fs.existsSync(CONFIG_PATH) && fs.existsSync(CONFIG_SRC)) {
      fs.copyFileSync(CONFIG_SRC, CONFIG_PATH);
    }
    if (fs.existsSync(DRAFTS_SRC)) {
      for (const f of fs.readdirSync(DRAFTS_SRC)) {
        const src = path.join(DRAFTS_SRC, f);
        const dst = path.join(DRAFTS_DIR, f);
        if (!fs.existsSync(dst) && f.endsWith('.md')) {
          fs.copyFileSync(src, dst);
        }
      }
    }
    listTemplates();
  }
}
bootstrapData();

const CONFIG_FIELDS = {
  default_template: { type: 'string', default: 'minimal' },
  output_dir: { type: 'string', default: 'articles/ready' },
  image_strategy: { type: 'string', default: 'local-warn', enum: ['local-keep', 'local-warn', 'cdn-replace'] },
  wechat: {
    type: 'object',
    fields: {
      app_id: { type: 'string', secret: false },
      app_secret: { type: 'string', secret: true }
    }
  },
  imageGen: {
    type: 'object',
    fields: {
      enabled: { type: 'boolean', default: true },
      provider: { type: 'string', default: 'agnes' },
      model: { type: 'string', default: 'agnes-image-2.1-flash' },
      defaultSize: { type: 'string', default: '1024x768' },
      apiKey: { type: 'string', secret: true }
    }
  }
};

const MASK = '••••••••';

function readConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function maskConfig(cfg) {
  const out = JSON.parse(JSON.stringify(cfg));
  for (const section of ['wechat', 'imageGen']) {
    const block = CONFIG_FIELDS[section];
    if (!block || !block.fields) continue;
    for (const [k, def] of Object.entries(block.fields)) {
      if (def.secret && out[section] && out[section][k]) {
        const v = out[section][k];
        if (typeof v === 'string' && v.length > 0) {
          out[section][k] = MASK;
        }
      }
    }
  }
  return out;
}

function configSummary(cfg) {
  const wechatOk = !!(cfg.wechat && cfg.wechat.app_id && cfg.wechat.app_secret) || !!(process.env.WECHAT_APP_ID && process.env.WECHAT_APP_SECRET);
  const imageGenConfigured = !!getApiKey();
  return {
    wechat_configured: wechatOk,
    imageGen_configured: imageGenConfigured,
    imageGen_provider: cfg.imageGen?.provider || 'agnes',
    imageGen_model: cfg.imageGen?.model || 'agnes-image-2.1-flash'
  };
}

function applyConfigUpdate(target, update, schema, pathParts = []) {
  for (const [key, value] of Object.entries(update)) {
    const def = schema[key];
    if (!def) {
      throw new Error(`Unknown field: ${[...pathParts, key].join('.')}`);
    }
    if (def.type === 'object' && def.fields) {
      target[key] = target[key] || {};
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        applyConfigUpdate(target[key], value, def.fields, [...pathParts, key]);
      } else if (value === null) {
        delete target[key];
      } else {
        throw new Error(`Field ${[...pathParts, key].join('.')} must be an object`);
      }
      continue;
    }
    if (value === null || value === '') {
      target[key] = '';
      continue;
    }
    if (def.type === 'string') {
      if (typeof value !== 'string') {
        throw new Error(`Field ${[...pathParts, key].join('.')} must be a string`);
      }
      if (def.enum && !def.enum.includes(value)) {
        throw new Error(`Field ${[...pathParts, key].join('.')} must be one of: ${def.enum.join(', ')}`);
      }
      target[key] = value;
    } else if (def.type === 'boolean') {
      target[key] = !!value;
    } else if (def.type === 'number') {
      const n = Number(value);
      if (Number.isNaN(n)) throw new Error(`Field ${[...pathParts, key].join('.')} must be a number`);
      target[key] = n;
    }
  }
}

function updateConfig(partial) {
  const current = readConfig();
  applyConfigUpdate(current, partial, CONFIG_FIELDS);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2) + '\n', 'utf-8');
  const srcPath = path.resolve(ROOT, 'config.json');
  const cached = require.cache[srcPath];
  if (cached) Object.assign(cached.exports, current);
  wechatApi.resetAccessToken();
  return current;
}

function slugify(s) {
  return String(s || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'untitled';
}

function listArticles() {
  const files = fs.readdirSync(DRAFTS_DIR).filter(f => f.endsWith('.md'));
  return files.map(filename => {
    const full = path.join(DRAFTS_DIR, filename);
    const raw = fs.readFileSync(full, 'utf-8');
    const parsed = matter(raw);
    const stat = fs.statSync(full);
    return {
      slug: filename.replace(/\.md$/, ''),
      filename,
      title: parsed.data.title || filename.replace(/\.md$/, ''),
      author: parsed.data.author || '',
      date: parsed.data.date || '',
      tags: parsed.data.tags || [],
      status: parsed.data.status || 'draft',
      updatedAt: stat.mtime.toISOString()
    };
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function readArticle(slug) {
  const safe = slug.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '');
  if (!safe) return null;
  const full = path.join(DRAFTS_DIR, `${safe}.md`);
  if (!fs.existsSync(full)) return null;
  const raw = fs.readFileSync(full, 'utf-8');
  const parsed = matter(raw);
  return {
    slug: safe,
    title: parsed.data.title || safe,
    author: parsed.data.author || '',
    date: parsed.data.date || '',
    tags: parsed.data.tags || [],
    status: parsed.data.status || 'draft',
    cover: parsed.data.cover || '',
    content: parsed.content,
    frontmatter: parsed.data
  };
}

function writeArticle(slug, payload) {
  const safe = slug.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '');
  if (!safe) throw new Error('Invalid slug');
  const fm = {
    title: payload.title || safe,
    slug: safe,
    author: payload.author || '',
    date: payload.date || new Date().toISOString().slice(0, 10),
    tags: payload.tags || [],
    status: payload.status || 'draft'
  };
  if (payload.cover !== undefined) fm.cover = payload.cover;
  const content = payload.content || '';
  const body = matter.stringify(content, fm);
  const full = path.join(DRAFTS_DIR, `${safe}.md`);
  fs.writeFileSync(full, body, 'utf-8');
  return { slug: safe, path: full };
}

function deleteArticle(slug) {
  const safe = slug.replace(/[^a-zA-Z0-9\u4e00-\u9fff_-]/g, '');
  const full = path.join(DRAFTS_DIR, `${safe}.md`);
  if (fs.existsSync(full)) fs.unlinkSync(full);
  return { slug: safe, deleted: true };
}

function renderMarkdown(content, template) {
  const cfg = readConfig();
  const tpl = template || cfg.default_template || 'minimal';
  const rawHtml = render(content, tpl);
  return handleImages(rawHtml, DRAFTS_DIR);
}

function buildArticleHtml(article, contentHtml) {
  const title = article.title || 'Untitled';
  const author = article.author || '';
  const date = article.date || '';
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
</head>
<body>
<section class="article-header" style="text-align:center;padding:20px 0 10px;">
<h1 style="font-size:22px;font-weight:700;margin:0 0 8px;">${esc(title)}</h1>
${author ? `<p style="color:#999;font-size:14px;margin:0 0 4px;">${esc(author)}</p>` : ''}
${date ? `<p style="color:#999;font-size:14px;margin:0;">${esc(date)}</p>` : ''}
</section>
${contentHtml}
</body>
</html>`;
}

const app = express();
app.use(express.json({ limit: '2mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
});

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    uptime: process.uptime(),
    ...configSummary(readConfig()),
    blob_storage: blobStorage.isBlobEnabled() ? 'enabled' : 'disabled'
  });
});

app.get('/api/config', (req, res) => {
  const cfg = readConfig();
  res.json({
    config: maskConfig(cfg),
    summary: configSummary(cfg),
    fields: CONFIG_FIELDS
  });
});

app.put('/api/config', (req, res) => {
  try {
    const update = req.body || {};
    if (typeof update !== 'object' || Array.isArray(update)) {
      return res.status(400).json({ error: 'Body must be a JSON object' });
    }
    const updated = updateConfig(update);
    res.json({ ok: true, config: maskConfig(updated), summary: configSummary(updated) });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Update failed' });
  }
});

app.get('/api/templates', (req, res) => {
  res.json(listTemplates());
});

app.get('/api/articles', (req, res) => {
  res.json(listArticles());
});

app.get('/api/articles/:slug', (req, res) => {
  const article = readArticle(req.params.slug);
  if (!article) return res.status(404).json({ error: 'Not found' });
  res.json(article);
});

app.post('/api/articles', (req, res) => {
  try {
    const { title, author, content, tags, status } = req.body || {};
    const slug = slugify(req.body?.slug || title);
    if (fs.existsSync(path.join(DRAFTS_DIR, `${slug}.md`))) {
      return res.status(409).json({ error: `Article "${slug}" already exists` });
    }
    const result = writeArticle(slug, {
      title: title || slug,
      author: author || '',
      content: content || '',
      tags: tags || [],
      status: status || 'draft',
      date: new Date().toISOString().slice(0, 10)
    });
    res.status(201).json({ ok: true, slug: result.slug });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/articles/:slug', (req, res) => {
  try {
    const existing = readArticle(req.params.slug);
    if (!existing) return res.status(404).json({ error: 'Not found' });
    const payload = {
      ...existing,
      ...(req.body || {}),
      slug: existing.slug
    };
    writeArticle(existing.slug, payload);
    res.json({ ok: true, slug: existing.slug });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.delete('/api/articles/:slug', (req, res) => {
  try {
    const result = deleteArticle(req.params.slug);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/render', (req, res) => {
  try {
    const { content, template, slug } = req.body || {};
    if (typeof content !== 'string') {
      return res.status(400).json({ error: 'content must be a string' });
    }
    let article = { title: '', author: '', date: '' };
    if (slug) {
      const a = readArticle(slug);
      if (a) article = a;
    } else if (req.body && req.body.frontmatter) {
      article = { ...article, ...req.body.frontmatter };
    }
    const contentHtml = renderMarkdown(content, template);
    const fullHtml = buildArticleHtml(article, contentHtml);
    res.json({ ok: true, html: fullHtml, contentHtml });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/convert', (req, res) => {
  try {
    const { slug, template } = req.body || {};
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const article = readArticle(slug);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const cfg = readConfig();
    const tpl = template || cfg.default_template || 'minimal';
    const contentHtml = renderMarkdown(article.content, tpl);
    const fullHtml = buildArticleHtml(article, contentHtml);
    fs.mkdirSync(READY_DIR, { recursive: true });
    const outPath = path.join(READY_DIR, `${article.slug}.${tpl}.html`);
    fs.writeFileSync(outPath, fullHtml, 'utf-8');
    res.json({ ok: true, path: outPath, slug: article.slug, template: tpl });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/publish', async (req, res) => {
  try {
    const { slug, template } = req.body || {};
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const article = readArticle(slug);
    if (!article) return res.status(404).json({ error: 'Article not found' });
    const cfg = readConfig();
    const tpl = template || cfg.default_template || 'minimal';
    const contentHtml = renderMarkdown(article.content, tpl);
    const fullHtml = buildArticleHtml(article, contentHtml);

    const wechatConfigured = !!(cfg.wechat && cfg.wechat.app_id && cfg.wechat.app_secret);
    if (!wechatConfigured) {
      fs.mkdirSync(PUBLISHED_DIR, { recursive: true });
      const outPath = path.join(PUBLISHED_DIR, `${article.slug}.${tpl}.html`);
      fs.writeFileSync(outPath, fullHtml, 'utf-8');
      return res.json({
        ok: true,
        mode: 'simulated',
        message: 'WeChat credentials not configured. Saved to articles/published/.',
        path: outPath,
        slug: article.slug
      });
    }

    try {
      const draft = await wechatApi.publishDraft(
        article.title,
        contentHtml,
        article.content.slice(0, 100),
        ''
      );
      res.json({ ok: true, mode: 'live', draft, slug: article.slug });
    } catch (err) {
      res.status(502).json({ error: err.message, mode: 'simulated_fallback' });
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/assets', async (req, res) => {
  if (!blobStorage.isBlobEnabled()) {
    const list = [];
    const dirs = DATA_DIR !== ROOT
      ? [path.join(DATA_DIR, 'assets'), path.join(ROOT, 'assets')]
      : [path.join(ROOT, 'assets')];
    for (const base of dirs) {
      if (!fs.existsSync(base)) continue;
      for (const sub of fs.readdirSync(base)) {
        const subDir = path.join(base, sub);
        if (!fs.statSync(subDir).isDirectory()) continue;
        for (const f of fs.readdirSync(subDir)) {
          list.push({
            name: f,
            type: sub,
            url: `/assets/${sub}/${f}`,
            storage: 'local'
          });
        }
      }
    }
    list.sort((a, b) => a.name.localeCompare(b.name));
    return res.json(list);
  }
  try {
    const result = await blobStorage.list();
    const assets = result.blobs.map(b => {
      const segments = b.pathname.split('/');
      const type = segments.length > 1 ? segments[0] : 'misc';
      const name = segments[segments.length - 1];
      return {
        name,
        type,
        url: b.url,
        pathname: b.pathname,
        size: b.size,
        uploadedAt: b.uploadedAt,
        contentType: b.contentType || 'image/png',
        storage: 'blob'
      };
    });
    assets.sort((a, b) => (b.uploadedAt || '').localeCompare(a.uploadedAt || ''));
    res.json(assets);
  } catch (err) {
    res.status(500).json({ error: err.message, code: 'BLOB_LIST_FAILED' });
  }
});

app.post('/api/generate-image', async (req, res) => {
  try {
    const { type, title, description, template } = req.body || {};
    if (!['cover', 'inline'].includes(type)) {
      return res.status(400).json({ error: 'type must be "cover" or "inline"' });
    }
    if (!getApiKey()) {
      return res.status(400).json({
        code: 'API_KEY_MISSING',
        error: 'AI 配图密钥未配置',
        hint: '请在设置页面填写 imageGen.apiKey，或 export AGNES_API_KEY=sk-xxx 后重启服务'
      });
    }
    const tpl = template || readConfig().default_template || 'minimal';
    const result = type === 'cover'
      ? await generateCover(title || 'untitled', description, tpl)
      : await generateInline(description || 'illustration', tpl);
    res.json({
      ok: true,
      type: result.type,
      template: tpl,
      path: result.path,
      url: result.url,
      storage: result.storage
    });
  } catch (err) {
    res.status(500).json({ code: 'GENERATE_FAILED', error: err.message });
  }
});

app.use(express.static(PUBLIC_DIR, { maxAge: '1h' }));

app.get(/^\/(?!api).*/, (req, res, next) => {
  const indexFile = path.join(PUBLIC_DIR, 'index.html');
  if (fs.existsSync(indexFile)) {
    res.sendFile(indexFile);
  } else {
    next();
  }
});

app.use((err, req, res, next) => {
  console.error('[server]', err);
  res.status(500).json({ error: err.message || 'Internal error' });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[wechat-workflow] listening on http://localhost:${PORT}`);
    const summary = configSummary(readConfig());
    console.log(`[wechat-workflow] wechat configured: ${summary.wechat_configured}`);
    console.log(`[wechat-workflow] imageGen configured: ${summary.imageGen_configured}`);
  });
}

module.exports = app;
