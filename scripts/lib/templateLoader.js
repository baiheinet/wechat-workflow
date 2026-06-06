const fs = require('fs');
const path = require('path');

const TEMPLATES_DIR = path.resolve(__dirname, '../../templates');

function loadTemplates() {
  const templates = {};
  const files = fs.readdirSync(TEMPLATES_DIR);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const tpl = JSON.parse(fs.readFileSync(path.join(TEMPLATES_DIR, file), 'utf-8'));
    templates[tpl.name] = tpl;
  }
  return templates;
}

function loadTemplate(name) {
  const templates = loadTemplates();
  if (!templates[name]) {
    throw new Error(`Template "${name}" not found. Available: ${Object.keys(templates).join(', ')}`);
  }
  return templates[name];
}

function listTemplates() {
  const templates = loadTemplates();
  return Object.values(templates).map(t => ({ name: t.name, label: t.label }));
}

module.exports = { loadTemplates, loadTemplate, listTemplates };
