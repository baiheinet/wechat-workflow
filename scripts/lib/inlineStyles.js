function applyInlineStyles(html, styles) {
  const TAGS = {
    body: 'body',
    h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4',
    p: 'p',
    strong: 'strong', em: 'em', del: 'del',
    a: 'a',
    blockquote: 'blockquote',
    code: 'code', pre_code: 'pre code',
    pre: 'pre',
    ul: 'ul', ol: 'ol', li: 'li',
    img: 'img',
    hr: 'hr',
    table: 'table', th: 'th', td: 'td'
  };

  let result = html;

  const prefers = { 'pre code': styles.pre_code || '' };

  for (const [selector, style] of Object.entries(styles)) {
    if (selector === 'pre_code') continue;
    const tag = TAGS[selector];
    if (!tag) continue;
    const attrStyle = prefers[selector] || style;
    if (!attrStyle) continue;
    result = result.replace(
      new RegExp(`<${tag}(?![a-zA-Z-])`, 'gi'),
      (match) => {
        return `<${tag} style="${attrStyle}"`;
      }
    );
  }

  for (const [selector, style] of Object.entries(prefers)) {
    if (!style) continue;
    result = result.replace(
      /<pre[^>]*>/gi,
      (match) => {
        return match;
      }
    );
    result = result.replace(
      /<code(?![a-zA-Z-])/gi,
      (match) => `<code style="${style}"`
    );
  }

  return result;
}

module.exports = { applyInlineStyles };
