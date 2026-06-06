const { marked } = require('marked');
const { loadTemplates } = require('./templateLoader');
const { applyInlineStyles } = require('./inlineStyles');

function render(markdown, templateName) {
  const templates = loadTemplates();
  const template = templates[templateName] || templates[Object.keys(templates)[0]];
  const styles = template.styles;
  const rawHtml = marked.parse(markdown, { gfm: true, breaks: false });
  const styledHtml = applyInlineStyles(rawHtml, styles);
  return styledHtml;
}

module.exports = { render };
