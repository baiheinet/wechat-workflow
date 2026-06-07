#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { loadTemplates } = require('./lib/templateLoader');
const { render } = require('./lib/markdownToHtml');

const OUT_DIR = path.resolve(__dirname, '../articles/ready');

const SAMPLE_MARKDOWN = `# 微信公众号工作流介绍

这是一篇**示例文章**，用于测试微信公众号全流程工作流的转换管线。

## 文本样式

普通的段落文字，用于测试基础排版。

**加粗文字** 和 *斜体文字* 以及 ~~删除线文字~~。

## 引用

> 这是引用块的内容。引用块用于突出显示某段重要文字或引用外部来源。

## 代码

行内代码 \`const x = 1\` 应该带有适当的样式。

代码块如下：

\`\`\`javascript
function hello() {
  console.log("Hello, WeChat!");
  return true;
}
\`\`\`

## 列表

无序列表：

- 第一项
- 第二项
- 第三项

有序列表：

1. 第一步
2. 第二步
3. 第三步

## 表格

| 功能 | 状态 | 优先级 |
|------|------|--------|
| Markdown 转换 | 已完成 | 高 |
| 模板系统 | 已完成 | 高 |
| 微信 API | 已完成 | 中 |
| 配图生成 | 进行中 | 中 |

## 链接

这是一个[示例链接](https://example.com)。

## 分割线

---

## 图片

![示例图片](assets/images/placeholder.png)
`;

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

  const markdown = SAMPLE_MARKDOWN;
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
