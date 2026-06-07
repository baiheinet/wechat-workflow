const http = require('http');
const path = require('path');

const blobs = new Map();
let seq = 0;
let blobPort = 0;
const blobServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1`);
  const pathname = decodeURIComponent(url.pathname.replace(/^\/blob\//, ''));
  const meta = blobs.get(pathname);
  if (!meta) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('Content-Type', meta.contentType || 'application/octet-stream');
  res.end(meta._data || '');
});
blobServer.listen(0, '127.0.0.1', () => {
  blobPort = blobServer.address().port;
  start();
});

function blobUrlFor(pathname) {
  return `http://127.0.0.1:${blobPort}/blob/${encodeURIComponent(pathname)}`;
}

const stub = {
  isBlobEnabled: () => true,
  async put(pathname, data, options = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    const meta = {
      url: blobUrlFor(pathname),
      pathname,
      size: buf.length,
      contentType: options.contentType || 'application/octet-stream',
      uploadedAt: new Date().toISOString(),
      _data: buf
    };
    blobs.set(pathname, meta);
    const { _data, ...rest } = meta;
    return rest;
  },
  async list(options = {}) {
    const prefix = options.prefix || '';
    const out = [];
    for (const [pathname, meta] of blobs) {
      if (!pathname.startsWith(prefix)) continue;
      const { _data, ...rest } = meta;
      out.push(rest);
    }
    return { blobs: out };
  },
  async del(p) {
    if (blobs.has(p)) blobs.delete(p);
    else {
      for (const [k, v] of blobs) {
        if (v.url === p) { blobs.delete(k); break; }
      }
    }
    return { ok: true };
  }
};

const realBlobPath = require.resolve('../scripts/lib/blobStorage');
const realBlob = require(realBlobPath);
realBlob.isBlobEnabled = stub.isBlobEnabled;
realBlob.put = stub.put;
realBlob.list = stub.list;
realBlob.del = stub.del;
process.env.BLOB_STORE_ID = 'test';

function start() {
  const app = require('../server.js');
  const server = http.createServer(app);
  const port = 31337;
  server.listen(port, async () => {
    const base = `http://127.0.0.1:${port}`;
    let pass = 0, fail = 0;
    function ok(name, cond, extra) {
      if (cond) { pass++; console.log(`  PASS ${name}`); }
      else { fail++; console.error(`  FAIL ${name}${extra ? ' — ' + extra : ''}`); }
    }
    async function req(method, url, body) {
      const init = { method, headers: { 'Content-Type': 'application/json' } };
      if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
      const r = await fetch(base + url, init);
      const text = await r.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { status: r.status, body: json, raw: text };
    }
    console.log('== Asset Manager API smoke ==');

    // 1. Empty list
    let r = await req('GET', '/api/assets?type=link');
    ok('GET empty list returns []', r.status === 200 && Array.isArray(r.body) && r.body.length === 0);

    // 2. Create link
    r = await req('POST', '/api/assets', { type: 'link', url: 'https://example.com', title: 'Example', category: '参考', tags: ['tag1'], article_slug: 'demo' });
    ok('POST link 201', r.status === 201 && r.body && r.body.id);
    const linkId = r.body && r.body.id;

    // 3. Create note
    r = await req('POST', '/api/assets', { type: 'note', content: '一段摘录文字。\n第二行。', title: '摘录', category: '灵感', tags: ['quote'] });
    ok('POST note 201', r.status === 201 && r.body && r.body.type === 'note');
    const noteId = r.body && r.body.id;

    // 4. Create file via upload then create
    const buf = Buffer.from('hello world');
    r = await req('POST', '/api/assets/upload', { filename: 'note.txt', contentType: 'text/plain', data: buf.toString('base64') });
    ok('POST upload 201', r.status === 201 && r.body && r.body.pathname);
    const up = r.body;
    r = await req('POST', '/api/assets', { type: 'file', title: 'My Note', filePathname: up.pathname, url: up.url, contentType: up.contentType, size: up.size, article_slug: 'demo', category: '文档' });
    ok('POST file asset 201', r.status === 201 && r.body && r.body.type === 'file');
    const fileId = r.body && r.body.id;

    // 5. List all
    r = await req('GET', '/api/assets');
    ok('GET all returns 3', r.status === 200 && r.body && r.body.length === 3);

    // 6. Filter by type=link
    r = await req('GET', '/api/assets?type=link');
    ok('GET type=link returns 1', r.status === 200 && r.body && r.body.length === 1 && r.body[0].type === 'link');

    // 7. Filter by article_slug
    r = await req('GET', '/api/assets?article_slug=demo');
    ok('GET article_slug=demo returns 2', r.status === 200 && r.body && r.body.length === 2);

    // 8. Search
    r = await req('GET', '/api/assets?q=example');
    ok('GET q=example matches link', r.status === 200 && r.body && r.body.length === 1 && r.body[0].type === 'link');

    // 9. Search across content
    r = await req('GET', '/api/assets?q=摘录');
    ok('GET q=摘录 matches note', r.status === 200 && r.body && r.body.length === 1 && r.body[0].type === 'note');

    // 10. Category filter
    r = await req('GET', '/api/assets?category=参考');
    ok('GET category=参考 returns 1', r.status === 200 && r.body && r.body.length === 1);

    // 11. Get by id
    r = await req('GET', `/api/assets/${linkId}`);
    ok('GET by id returns asset', r.status === 200 && r.body && r.body.id === linkId);

    // 12. Update
    r = await req('PUT', `/api/assets/${noteId}`, { title: '更新后的摘录', category: '想法' });
    ok('PUT updates title', r.status === 200 && r.body && r.body.title === '更新后的摘录' && r.body.category === '想法');

    // 13. Validation: link without url
    r = await req('POST', '/api/assets', { type: 'link' });
    ok('POST link without url 400', r.status === 400);

    // 14. Validation: bad type
    r = await req('POST', '/api/assets', { type: 'whatever' });
    ok('POST bad type 400', r.status === 400);

    // 15. Delete file asset (cleans both index + file blob)
    r = await req('DELETE', `/api/assets/${fileId}`);
    ok('DELETE file 200', r.status === 200 && r.body && r.body.id === fileId);
    r = await req('GET', '/api/assets');
    ok('After delete list returns 2', r.status === 200 && r.body && r.body.length === 2);

    // 16. Delete link
    r = await req('DELETE', `/api/assets/${linkId}`);
    ok('DELETE link 200', r.status === 200);

    // 17. Delete missing
    r = await req('DELETE', `/api/assets/nope`);
    ok('DELETE missing 404', r.status === 404);

    console.log(`\n${pass} passed, ${fail} failed`);
    server.close();
    blobServer.close();
    process.exit(fail === 0 ? 0 : 1);
  });
}
