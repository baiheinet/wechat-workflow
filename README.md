# WeChat Workflow

微信公众号文章全流程工作流工具。Markdown → 内联样式 HTML → 微信草稿箱 → 发布 → 数据复盘。

## 目录结构

```
wechat-workflow/
├── articles/{drafts,ready,published}/   # 文章各阶段
├── assets/{covers,images}/              # 素材文件
├── templates/                           # 排版模板 (JSON)
├── scripts/
│   ├── convert.js                       # CLI 入口
│   ├── test.js                          # 冒烟测试
│   └── lib/
│       ├── markdownToHtml.js            # Markdown 解析
│       ├── templateLoader.js            # 模板加载
│       ├── imageHandler.js              # 图片处理
│       ├── inlineStyles.js              # 内联样式注入
│       └── wechatApi.js                 # 微信 API 集成
├── config.json                          # 配置文件
└── package.json
```

## 快速开始

```bash
# 安装依赖
npm install

# 转换文章
node scripts/convert.js articles/drafts/my-post.md --template minimal

# 运行测试
npm test
```

## 排版模板

三套预设模板：

| 模板名 | 风格 | 适用场景 |
|--------|------|----------|
| minimal | 简约 | 通用文章 |
| tech | 科技 | 技术文章 |
| literary | 文艺 | 文学/随笔 |

## 完整管线

1. 在 `articles/drafts/` 写 Markdown 文章（带 YAML frontmatter）
2. `node scripts/convert.js` 转换为内联样式 HTML
3. 自动上传图片到微信素材库
4. 通过 API 推送到微信草稿箱
5. 登录公众号后台审核发布
6. 数据复盘（阅读量等）

## 配置

编辑 `config.json` 设置微信 AppID/AppSecret 等参数。
