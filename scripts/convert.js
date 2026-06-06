#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const { render } = require('./lib/markdownToHtml');
const { handleImages } = require('./lib/imageHandler');
const { listTemplates } = require('./lib/templateLoader');
const config = require('../config.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { template: config.default_template || 'minimal' };
  let filePath = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--template' && args[i + 1]) {
      opts.template = args[++i];
    } else if (args[i] === '--out' && args[i + 1]) {
      opts.out = args[++i];
    } else {
      filePath = args[i];
    }
  }
  if (!filePath) {
    console.error('Usage: node scripts/convert.js <markdown-file> [--template <name>] [--out <path>]');
    console.error('Templates:');
    const tpls = listTemplates();
    tpls.forEach(t => console.error(`  ${t.name} — ${t.label}`));
    process.exit(1);
  }
  return { filePath, ...opts };
}

function buildHtml(frontmatter, contentHtml) {
  const title = frontmatter.title || 'Untitled';
  const author = frontmatter.author || '';
  const date = frontmatter.date || '';
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
</head>
<body>
<section class="article-header" style="text-align:center;padding:20px 0 10px;">
<h1 style="font-size:22px;font-weight:700;margin:0 0 8px;">${escapeHtml(title)}</h1>
${author ? `<p style="color:#999;font-size:14px;margin:0 0 4px;">${escapeHtml(author)}</p>` : ''}
${date ? `<p style="color:#999;font-size:14px;margin:0;">${escapeHtml(date)}</p>` : ''}
</section>
${contentHtml}
</body>
</html>`;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function main() {
  const { filePath, template, out } = parseArgs();
  const fileContent = fs.readFileSync(filePath, 'utf-8');
  const parsed = matter(fileContent);
  const contentHtml = render(parsed.content, template);
  const handledHtml = handleImages(contentHtml, path.dirname(filePath));
  const fullHtml = buildHtml(parsed.data, handledHtml);

  const outPath = out || path.join(config.output_dir || 'articles/ready', `${parsed.data.slug || path.basename(filePath, '.md')}.${template}.html`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, fullHtml, 'utf-8');
  console.log(`Converted: ${filePath} → ${outPath} (template: ${template})`);
}

main();
