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

const PROMPT_PRESETS = {
  style: {
    '摄影写实': 'photorealistic, photographic, high detail',
    '插画手绘': 'hand-drawn illustration, watercolor, painterly',
    '国风': 'Chinese traditional style, ink wash, gongbi',
    '科技感': 'futuristic, high-tech, sci-fi aesthetic, neon',
    '极简': 'minimalist, clean lines, ample negative space',
    '动漫': 'anime style, cel-shaded, vibrant colors'
  },
  scene: {
    '室内': 'indoor setting, interior space',
    '户外': 'outdoor setting, exterior',
    '城市': 'urban cityscape, modern city',
    '自然': 'natural landscape, wilderness',
    '抽象': 'abstract background, non-representational',
    '特写': 'extreme close-up, detailed focus'
  },
  lighting: {
    '自然光': 'natural daylight, soft sun',
    '暖光': 'warm lighting, golden hour, amber tones',
    '冷光': 'cool lighting, blue tones, moonlight',
    '逆光': 'backlit, rim lighting, silhouette effect',
    '柔和散射': 'soft diffused lighting, even illumination',
    '戏剧光': 'dramatic lighting, high contrast, chiaroscuro'
  },
  composition: {
    '居中': 'centered composition, subject in middle',
    '三分法': 'rule of thirds composition',
    '对角线': 'diagonal composition, dynamic angle',
    '俯拍': 'overhead shot, bird\'s eye view, top-down',
    '平视': 'eye-level shot, straight-on perspective',
    '特写': 'close-up shot, tight framing'
  },
  quality: {
    '高清': 'high definition, sharp details',
    '超写实': 'ultra-realistic, hyperrealistic',
    '专业摄影': 'professional photography, studio quality',
    '商业级': 'commercial grade, advertising quality',
    '艺术级': 'fine art, gallery quality, museum-grade'
  }
};

function buildStructuredPrompt({ subject, scene, style, lighting, composition, quality }, type = 'inline') {
  const parts = [];
  if (subject && String(subject).trim()) parts.push(String(subject).trim());
  const s = PROMPT_PRESETS.style[style];
  const sc = PROMPT_PRESETS.scene[scene];
  const l = PROMPT_PRESETS.lighting[lighting];
  const c = PROMPT_PRESETS.composition[composition];
  const q = PROMPT_PRESETS.quality[quality];
  if (s) parts.push(s);
  if (sc) parts.push(sc);
  if (l) parts.push(l);
  if (c) parts.push(c);
  if (q) parts.push(q);
  if (type === 'cover') {
    parts.push('horizontal format, WeChat article cover image');
  }
  return parts.join(', ');
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

function generateCover(title, description, template, promptOptions) {
  const prompt = promptOptions
    ? buildStructuredPrompt(promptOptions, 'cover')
    : buildPrompt(template, 'cover', title, description);
  const slug = title ? title.replace(/[^a-zA-Z0-9\u4e00-\u9fff]/g, '_').slice(0, 40) : 'cover';
  return generateAndStore({
    prompt,
    subdir: 'covers',
    filename: `${slug}_cover`,
    ext: '.png'
  }).then(result => ({ ...result, type: 'cover' }));
}

function generateInline(description, template, promptOptions) {
  const prompt = promptOptions
    ? buildStructuredPrompt(promptOptions, 'inline')
    : buildPrompt(template, 'inline', '', description);
  return generateAndStore({
    prompt,
    subdir: 'images',
    filename: `inline_${Date.now()}`,
    ext: '.png'
  }).then(result => ({ ...result, type: 'inline' }));
}

module.exports = {
  generate,
  generateCover,
  generateInline,
  buildPrompt,
  buildStructuredPrompt,
  PROMPT_PRESETS,
  getApiKey
};
