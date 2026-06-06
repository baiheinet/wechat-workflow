const path = require('path');
const config = require('../../config.json');

function handleImages(html, articleDir) {
  const strategy = config.image_strategy || 'local-warn';
  return html.replace(/<img\s+([^>]*?)src="([^"]+)"([^>]*)>/gi, (match, before, src, after) => {
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('data:')) {
      return match;
    }
    switch (strategy) {
      case 'local-keep':
        const absPath = path.resolve(articleDir, src);
        return `<img ${before}src="${src}"${after}>`;
      case 'cdn-replace':
        return `<img ${before}src="" data-original="${src}"${after}>`;
      case 'local-warn':
      default:
        console.warn(`[WARN] Local image reference: ${src} (resolves to ${path.resolve(articleDir, src)})`);
        return `<img ${before}src="${src}"${after}>`;
    }
  });
}

module.exports = { handleImages };
