const https = require('https');
const fs = require('fs');
const path = require('path');
const config = require('../../config.json');

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

function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(outputPath);
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed with status ${res.statusCode}`));
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(outputPath);
      });
    }).on('error', (err) => {
      fs.unlinkSync(outputPath);
      reject(err);
    });
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

function generateCover(title, description, template) {
  const prompt = buildPrompt(template, 'cover', title, description);
  const outDir = path.resolve(__dirname, '../../assets/covers');
  fs.mkdirSync(outDir, { recursive: true });
  return generate(prompt, { size: '1024x768' }).then(result => {
    const ext = path.extname(new URL(result.url).pathname) || '.png';
    const slug = title ? title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 40) : 'cover';
    const filename = `${slug}_cover${ext}`;
    const outputPath = path.join(outDir, filename);
    return downloadImage(result.url, outputPath).then(() => {
      return { path: `assets/covers/${filename}`, url: result.url, type: 'cover' };
    });
  });
}

function generateInline(description, template) {
  const prompt = buildPrompt(template, 'inline', '', description);
  const outDir = path.resolve(__dirname, '../../assets/images');
  fs.mkdirSync(outDir, { recursive: true });
  return generate(prompt, { size: '1024x768' }).then(result => {
    const ext = path.extname(new URL(result.url).pathname) || '.png';
    const filename = `inline_${Date.now()}${ext}`;
    const outputPath = path.join(outDir, filename);
    return downloadImage(result.url, outputPath).then(() => {
      return { path: `assets/images/${filename}`, url: result.url, type: 'inline' };
    });
  });
}

module.exports = { generate, generateCover, generateInline, buildPrompt, getApiKey };
