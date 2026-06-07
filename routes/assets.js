const express = require('express');
const crypto = require('crypto');
const blobStorage = require('../scripts/lib/blobStorage');

const router = express.Router();

const INDEX_PREFIX = 'assets/index/';
const FILE_PREFIX = 'assets/files/';
const TYPES = new Set(['link', 'file', 'note']);

function nowIso() {
  return new Date().toISOString();
}

function newId() {
  return Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
}

function safeName(s) {
  return String(s || '').replace(/[^a-zA-Z0-9\u4e00-\u9fff._-]/g, '_').slice(0, 80) || 'file';
}

function requireBlob() {
  if (!blobStorage.isBlobEnabled()) {
    const err = new Error('Blob Storage not configured — set BLOB_READ_WRITE_TOKEN or BLOB_STORE_ID env var');
    err.code = 'BLOB_NOT_CONFIGURED';
    throw err;
  }
}

async function listAssetIndex() {
  const result = await blobStorage.list({ prefix: INDEX_PREFIX });
  const out = [];
  for (const b of result.blobs || []) {
    if (!b.pathname.endsWith('.json')) continue;
    try {
      const res = await fetch(b.url);
      if (!res.ok) continue;
      const data = await res.json();
      out.push({ ...data, _pathname: b.pathname, _url: b.url });
    } catch (err) {
      // skip malformed entry
    }
  }
  return out;
}

function sanitizeAsset(a) {
  const { _pathname, _url, ...rest } = a;
  return rest;
}

function matches(asset, { q, article_slug, category, type }) {
  if (type && asset.type !== type) return false;
  if (article_slug && asset.article_slug !== article_slug) return false;
  if (category && asset.category !== category) return false;
  if (q) {
    const needle = String(q).toLowerCase();
    const haystack = [
      asset.title || '',
      asset.url || '',
      asset.content || '',
      (asset.tags || []).join(' ')
    ].join(' ').toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

router.get('/', async (req, res, next) => {
  try {
    requireBlob();
    const items = await listAssetIndex();
    const filtered = items.filter(a => matches(a, req.query));
    filtered.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    res.json(filtered.map(sanitizeAsset));
  } catch (err) { next(err); }
});

router.get('/:id', async (req, res, next) => {
  try {
    requireBlob();
    const items = await listAssetIndex();
    const found = items.find(a => a.id === req.params.id);
    if (!found) return res.status(404).json({ error: 'Asset not found' });
    res.json(sanitizeAsset(found));
  } catch (err) { next(err); }
});

const uploadJson = express.json({ limit: '20mb' });

router.post('/upload', uploadJson, async (req, res, next) => {
  try {
    requireBlob();
    const body = req.body || {};
    const { filename, contentType, data } = body;
    if (!data || typeof data !== 'string') {
      return res.status(400).json({ error: 'data (base64 string) required' });
    }
    const buf = Buffer.from(data, 'base64');
    if (!buf.length) return res.status(400).json({ error: 'empty file' });
    const id = newId();
    const safe = safeName(filename || 'file');
    const pathname = `${FILE_PREFIX}${id}-${safe}`;
    const result = await blobStorage.put(pathname, buf, {
      access: 'public',
      contentType: contentType || 'application/octet-stream',
      allowOverwrite: false
    });
    res.status(201).json({
      pathname: result.pathname,
      url: result.url,
      size: buf.length,
      contentType: contentType || 'application/octet-stream',
      filename: safe
    });
  } catch (err) { next(err); }
});

router.post('/', async (req, res, next) => {
  try {
    requireBlob();
    const body = req.body || {};
    const type = body.type;
    if (!TYPES.has(type)) {
      return res.status(400).json({ error: 'type must be one of: link, file, note' });
    }
    const id = body.id || newId();
    const ts = nowIso();
    const asset = {
      id,
      type,
      title: typeof body.title === 'string' ? body.title : '',
      category: typeof body.category === 'string' ? body.category : '',
      tags: Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string') : [],
      article_slug: typeof body.article_slug === 'string' ? body.article_slug : '',
      url: typeof body.url === 'string' ? body.url : '',
      content: typeof body.content === 'string' ? body.content : '',
      contentType: typeof body.contentType === 'string' ? body.contentType : '',
      size: typeof body.size === 'number' ? body.size : 0,
      filePathname: typeof body.filePathname === 'string' ? body.filePathname : '',
      createdAt: ts,
      updatedAt: ts
    };

    if (type === 'link') {
      if (!asset.url) return res.status(400).json({ error: 'link requires url' });
      if (!asset.title) asset.title = asset.url;
    } else if (type === 'note') {
      if (!asset.content) return res.status(400).json({ error: 'note requires content' });
      if (!asset.title) asset.title = asset.content.slice(0, 40);
    } else if (type === 'file') {
      if (!asset.filePathname || !asset.url) {
        return res.status(400).json({ error: 'file asset requires filePathname and url (upload first via /api/assets/upload)' });
      }
    }

    const pathname = `${INDEX_PREFIX}${id}.json`;
    const buf = Buffer.from(JSON.stringify(asset, null, 2), 'utf-8');
    await blobStorage.put(pathname, buf, {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true
    });
    res.status(201).json(asset);
  } catch (err) { next(err); }
});

router.put('/:id', async (req, res, next) => {
  try {
    requireBlob();
    const body = req.body || {};
    const items = await listAssetIndex();
    const existing = items.find(a => a.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found' });
    const updated = { ...existing };
    for (const k of ['title', 'category', 'url', 'content', 'article_slug', 'contentType', 'filePathname']) {
      if (k in body) updated[k] = body[k];
    }
    if ('tags' in body) {
      updated.tags = Array.isArray(body.tags) ? body.tags.filter(t => typeof t === 'string') : [];
    }
    if ('size' in body && typeof body.size === 'number') updated.size = body.size;
    if (body.type && TYPES.has(body.type)) updated.type = body.type;
    updated.updatedAt = nowIso();
    delete updated._pathname;
    delete updated._url;
    const pathname = `${INDEX_PREFIX}${updated.id}.json`;
    const buf = Buffer.from(JSON.stringify(updated, null, 2), 'utf-8');
    await blobStorage.put(pathname, buf, {
      access: 'public',
      contentType: 'application/json',
      allowOverwrite: true
    });
    res.json(updated);
  } catch (err) { next(err); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    requireBlob();
    const items = await listAssetIndex();
    const existing = items.find(a => a.id === req.params.id);
    if (!existing) return res.status(404).json({ error: 'Asset not found' });
    if (existing._url) {
      await blobStorage.del(existing._url).catch(() => {});
    }
    if (existing.filePathname && existing.url) {
      await blobStorage.del(existing.url).catch(() => {});
    }
    res.json({ ok: true, id: existing.id });
  } catch (err) { next(err); }
});

module.exports = router;
