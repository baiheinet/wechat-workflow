#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadTemplates } = require('./lib/templateLoader');
const { render } = require('./lib/markdownToHtml');

const SAMPLE = path.resolve(__dirname, '../articles/drafts/sample.md');
const OUT_DIR = path.resolve(__dirname, '../articles/ready');

function checkStyles(html, templateName) {
  const checks = [
    { tag: 'h1', msg: 'h1 should have inline style' },
    { tag: 'h2', msg: 'h2 should have inline style' },
    { tag: 'p', msg: 'p should have inline style' },
    { tag: 'blockquote', msg: 'blockquote should have inline style' },
    { tag: 'pre', msg: 'pre should have inline style' },
    { tag: 'strong', msg: 'strong should have inline style' },
    { tag: 'ul', msg: 'ul should have inline style' },
    { tag: 'table', msg: 'table should have inline style' },
    { tag: 'img', msg: 'img should have inline style' }
  ];
  const failed = [];
  for (const { tag, msg } of checks) {
    const re = new RegExp(`<${tag}[^>]*style=`);
    if (!re.test(html)) {
      failed.push(`FAIL: ${msg} (template: ${templateName})`);
    }
  }
  return failed;
}

function main() {
  console.log('=== WeChat Workflow Smoke Tests ===\n');

  const templates = loadTemplates();
  const tplNames = Object.keys(templates);
  console.log(`Templates found: ${tplNames.join(', ')}`);

  if (!fs.existsSync(SAMPLE)) {
    console.error(`ERROR: Sample article not found at ${SAMPLE}`);
    process.exit(1);
  }

  const markdown = fs.readFileSync(SAMPLE, 'utf-8');
  let totalFailed = 0;

  for (const name of tplNames) {
    console.log(`\n--- Template: ${name} ---`);
    try {
      const html = render(markdown, name);
      const outPath = path.join(OUT_DIR, `sample.${name}.html`);
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      fs.writeFileSync(outPath, html, 'utf-8');
      console.log(`Output: ${outPath} (${Buffer.byteLength(html, 'utf-8')} bytes)`);

      const failures = checkStyles(html, name);
      if (failures.length === 0) {
        console.log('All style checks passed');
      } else {
        failures.forEach(f => console.error(f));
        totalFailed += failures.length;
      }
    } catch (err) {
      console.error(`ERROR: ${err.message}`);
      totalFailed++;
    }
  }

  console.log(`\n=== ${totalFailed === 0 ? 'ALL PASSED' : `${totalFailed} FAILURES`} ===`);
  process.exit(totalFailed > 0 ? 1 : 0);
}

main();
