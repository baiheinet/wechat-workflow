const https = require('https');
const path = require('path');
const config = require('../../config.json');
const blobStorage = require('./blobStorage');

const AGNES_ENDPOINT = 'apihub.agnes-ai.com';

function getApiKey() {
  return process.env.AGNES_API_KEY || config.imageGen?.apiKey || '';
}

function generate(prompt, options = {}) {
  return new Promise((resolve, reject) => {
    const apiKey = getApiKey();
    if (!apiKey) {
      reject(new Error('AGNES_API_KEY not set. Set environment variable or add imageGen.apiKey to config.json'));
      return;
    }
    const size = options.size || config.imageGen?.defaultSize || '1024x768';
    const model = options.model || config.imageGen?.model || 'agnes-image-2.1-flash';
    const body = JSON.stringify({ model, prompt, size, n: 1 });
    const req = https.request({
      hostname: AGNES_ENDPOINT,
      path: '/v1/images/generations',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.data && json.data.length > 0) {
            resolve(json.data[0]);
          } else if (json.error) {
            reject(new Error(`API error: ${json.error.message || JSON.stringify(json.error)}`));
          } else {
            reject(new Error(`Unexpected response: ${data.slice(0, 200)}`));
          }
        } catch (e) {
          reject(new Error(`Parse error: ${e.message}. Raw: ${data.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function downloadToBuffer(url) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadToBuffer(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed with status ${res.statusCode}`));
        return;
      }
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function buildPrompt(template, type, title, description) {
  const styleHints = {
    minimal: 'clean, minimalistic, ample whitespace, neutral colors',
    tech: 'technology-themed, blue tones, modern, sleek',
    literary: 'warm tones, artistic, soft lighting, literary atmosphere'
  };
  const style = styleHints[template] || styleHints.minimal;
  if (type === 'cover') {
    return `${title ? `Article titled "${title}". ` : ''}${description ? `${description}. ` : ''}WeChat article cover image, ${style}, horizontal format, professional, high quality`;
  }
  return `${description || title || 'Article illustration'}, ${style}, illustration style, high quality`;
}

async function uploadToBlob(buffer, pathname) {
  if (!blobStorage.isBlobEnabled()) {
    throw new Error('Blob Storage not configured — set BLOB_STORE_ID env var');
  }
  const result = await blobStorage.put(pathname, buffer, {
    access: 'public',
    contentType: 'image/png',
    allowOverwrite: true
  });
  return {
    path: result.pathname,
    url: result.url,
    storage: 'blob'
  };
}

async function generateAndStore({ prompt, subdir, filename, ext }) {
  if (!blobStorage.isBlobEnabled()) {
    throw new Error('Blob Storage not configured — set BLOB_STORE_ID env var');
  }
  const apiResult = await generate(prompt, { size: '1024x768' });
  const realExt = ext || (path.extname(new URL(apiResult.url).pathname) || '.png');
  const finalFilename = filename.replace(/\.[^.]+$/, '') + realExt;
  const pathname = `${subdir}/${finalFilename}`;
  const buffer = await downloadToBuffer(apiResult.url);
  return uploadToBlob(buffer, pathname);
}

function generateCover(title, description, template) {
  const prompt = buildPrompt(template, 'cover', title, description);
  const slug = title ? title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 40) : 'cover';
  return generateAndStore({
    prompt,
    subdir: 'covers',
    filename: `${slug}_cover`,
    ext: '.png'
  }).then(result => ({ ...result, type: 'cover' }));
}

function generateInline(description, template) {
  const prompt = buildPrompt(template, 'inline', '', description);
  return generateAndStore({
    prompt,
    subdir: 'images',
    filename: `inline_${Date.now()}`,
    ext: '.png'
  }).then(result => ({ ...result, type: 'inline' }));
}

module.exports = { generate, generateCover, generateInline, buildPrompt, getApiKey };
