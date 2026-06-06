const path = require('path');
const { generateCover, generateInline } = require('./imageGen');
const config = require('../../config.json');

function isImageGenEnabled() {
  return config.imageGen?.enabled !== false;
}

function autoGenerateCover(title, description, template) {
  if (!isImageGenEnabled()) return Promise.resolve(null);
  if (!title && !description) return Promise.resolve(null);
  console.log(`[imageGen] Generating cover for: ${title || 'untitled'}`);
  return generateCover(title, description, template).catch(err => {
    console.error(`[imageGen] Cover generation failed: ${err.message}`);
    return null;
  });
}

function autoGenerateIllustrations(content, template) {
  if (!isImageGenEnabled()) return Promise.resolve([]);
  const results = [];
  const imgRegex = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let match;
  while ((match = imgRegex.exec(content)) !== null) {
    const src = match[1];
    if (src.startsWith('http') || src.startsWith('data:')) continue;
    results.push({ src, index: results.length });
  }
  if (results.length === 0) return Promise.resolve([]);
  console.log(`[imageGen] Generating ${results.length} inline illustration(s)`);
  return Promise.all(results.map(r => {
    return generateInline(`Illustration ${r.index + 1} for article`, template).then(result => {
      return { original: r.src, generated: result.path };
    }).catch(err => {
      console.error(`[imageGen] Inline generation failed: ${err.message}`);
      return null;
    });
  })).then(resolved => resolved.filter(Boolean));
}

module.exports = { autoGenerateCover, autoGenerateIllustrations };
