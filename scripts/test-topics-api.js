#!/usr/bin/env node
const path = require('path');
const fs = require('fs');

// Patch blobStorage wrapper with an in-memory mock
const memory = new Map();
let counter = 0;

// Override global fetch so that fake.blob URLs are served from memory
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (typeof url === 'string' && url.startsWith('https://fake.blob/')) {
    const u = new URL(url);
    // pathname is /test/<encoded pathname>
    const encPath = u.pathname.replace(/^\/test\//, '');
    const pathname = decodeURIComponent(encPath);
    const meta = memory.get(pathname);
    if (!meta) {
      return new Response('not found', { status: 404 });
    }
    return new Response(meta.body, { status: 200, headers: { 'content-type': meta.contentType } });
  }
  return origFetch(url, opts);
};

const fakeBlobStorage = {
  isBlobEnabled: () => true,
  async put(pathname, data, opts = {}) {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    const url = `https://fake.blob/test/${encodeURIComponent(pathname)}?v=${++counter}`;
    const uploadedAt = new Date().toISOString();
    memory.set(pathname, { url, pathname, body: buf, contentType: opts.contentType || 'application/octet-stream', uploadedAt });
    return { url, pathname, contentType: opts.contentType || 'application/octet-stream', uploadedAt };
  },
  async list({ prefix } = {}) {
    const blobs = [];
    for (const [pathname, meta] of memory.entries()) {
      if (prefix && !pathname.startsWith(prefix)) continue;
      blobs.push({ pathname, url: meta.url, uploadedAt: meta.uploadedAt, size: meta.body.length, contentType: meta.contentType });
    }
    return { blobs, cursor: null };
  },
  async del(urlOrPath) {
    if (typeof urlOrPath === 'string' && urlOrPath.startsWith('http')) {
      for (const [p, m] of memory.entries()) {
        if (m.url === urlOrPath) { memory.delete(p); return; }
      }
    } else if (memory.has(urlOrPath)) {
      memory.delete(urlOrPath);
    }
  }
};

// Load blobStorage first so we can patch its module-level exports
const blobStoragePath = require.resolve('../scripts/lib/blobStorage');
require(blobStoragePath);
const blobStorageModule = require(blobStoragePath);
// Overwrite the exports on the live module
for (const k of Object.keys(fakeBlobStorage)) blobStorageModule[k] = fakeBlobStorage[k];

process.env.BLOB_STORE_ID = 'fake';
process.env.PORT = '0';
process.env.VERCEL = '';

// Now require the app
const app = require('../server.js');

const http = require('http');
function request(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      method,
      hostname: '127.0.0.1',
      port: 0,
      path: urlPath,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    };
    // We use the app directly via supertest-like pattern... or just use a listen-then-close
    resolve({ method, urlPath, body });
  });
}

async function listen() {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, '127.0.0.1', () => resolve(server));
    server.on('error', reject);
  });
}

function call(server, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const port = server.address().port;
    const req = http.request({
      hostname: '127.0.0.1', port, path: encodeURI(urlPath), method,
      headers: data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks).toString('utf-8');
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (err) { parsed = buf; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    process.exit(1);
  } else {
    console.log('OK  :', msg);
  }
}

(async () => {
  const server = await listen();
  let pass = 0;
  try {
    // 1. /api/topics/meta
    {
      const r = await call(server, 'GET', '/api/topics/meta');
      assert(r.status === 200, 'GET /api/topics/meta → 200');
      assert(r.body.statuses.length === 6, 'has 6 statuses');
      assert(r.body.priorities.length === 4, 'has 4 priorities');
      assert(r.body.statuses[0].value === 'idea', 'first status is idea');
      pass++;
    }

    // 2. Initial list should be empty
    {
      const r = await call(server, 'GET', '/api/topics');
      assert(r.status === 200, 'GET /api/topics → 200');
      assert(Array.isArray(r.body) && r.body.length === 0, 'initial list is empty');
      pass++;
    }

    // 3. Create a topic
    let slug = '';
    {
      const r = await call(server, 'POST', '/api/topics', {
        title: '测试选题',
        summary: '这是测试摘要',
        source: 'https://example.com',
        status: 'idea',
        priority: 'P1'
      });
      assert(r.status === 201, 'POST /api/topics → 201');
      assert(typeof r.body.slug === 'string' && r.body.slug.length > 0, 'returns slug');
      slug = r.body.slug;
      pass++;
    }

    // 4. Get that topic
    {
      const r = await call(server, 'GET', `/api/topics/${slug}`);
      assert(r.status === 200, 'GET /api/topics/:slug → 200');
      assert(r.body.title === '测试选题', 'title roundtrips');
      assert(r.body.status === 'idea', 'status roundtrips');
      assert(r.body.priority === 'P1', 'priority roundtrips');
      assert(r.body.source === 'https://example.com', 'source roundtrips');
      pass++;
    }

    // 5. List now has 1
    {
      const r = await call(server, 'GET', '/api/topics');
      assert(r.body.length === 1, 'list has 1 topic');
      pass++;
    }

    // 6. Update status
    {
      const r = await call(server, 'PUT', `/api/topics/${slug}`, { status: 'writing' });
      assert(r.status === 200, 'PUT /api/topics/:slug → 200');
      pass++;
    }
    {
      const r = await call(server, 'GET', `/api/topics/${slug}`);
      assert(r.body.status === 'writing', 'status updated to writing');
      pass++;
    }

    // 7. Create with invalid status defaults to idea
    let slug2 = '';
    {
      const r = await call(server, 'POST', '/api/topics', {
        title: 'Invalid Status',
        status: 'nonexistent'
      });
      assert(r.status === 201, 'create with invalid status still 201');
      slug2 = r.body.slug;
    }
    {
      const r = await call(server, 'GET', `/api/topics/${slug2}`);
      assert(r.body.status === 'idea', 'invalid status falls back to idea');
    }

    // 8. Create without title fails
    {
      const r = await call(server, 'POST', '/api/topics', { summary: 'no title' });
      assert(r.status === 400, 'create without title → 400');
      pass++;
    }

    // 9. Create duplicate slug fails
    {
      const r = await call(server, 'POST', '/api/topics', { title: '测试选题' });
      assert(r.status === 409, 'duplicate slug → 409');
      pass++;
    }

    // 10. Update non-existent
    {
      const r = await call(server, 'PUT', '/api/topics/nonexistent', { title: 'x' });
      assert(r.status === 404, 'update non-existent → 404');
      pass++;
    }

    // 11. Delete
    {
      const r = await call(server, 'DELETE', `/api/topics/${slug}`);
      assert(r.status === 200, 'DELETE /api/topics/:slug → 200');
      pass++;
    }
    {
      const r = await call(server, 'GET', `/api/topics/${slug}`);
      assert(r.status === 404, 'deleted topic → 404');
      pass++;
    }

    // 12. Static file (sanity check)
    {
      const r = await call(server, 'GET', '/index.html');
      assert(r.status === 200, 'GET /index.html → 200');
    }

    console.log(`\n=== TOPIC API: ${pass} checks passed ===`);
  } catch (err) {
    console.error('TEST CRASHED:', err);
    process.exit(1);
  } finally {
    server.close();
  }
})();
