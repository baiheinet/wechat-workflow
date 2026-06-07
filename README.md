# WeChat Workflow

微信公众号写作全流程 Web 工作台：浏览器里写 Markdown → 实时预览 → 一键导出 / 推送到微信草稿箱 / AI 配图。所有密钥（微信 AppID/AppSecret、Agnes 配图 API Key）通过顶栏齿轮 → 设置面板统一管理，写入 `config.json`。

## 目录结构

```
wechat-workflow/
├── articles/{drafts,ready,published}/   # 文章各阶段
├── assets/{covers,images}/              # 素材文件（AI 生成图自动落在这里）
├── templates/                           # 排版模板 (JSON)
├── scripts/                             # 核心转换逻辑（CLI 与 Web 共享）
│   ├── convert.js                       # CLI 入口
│   ├── test.js                          # 冒烟测试
│   ├── image-gen.js                     # CLI 生图入口
│   └── lib/
│       ├── markdownToHtml.js            # Markdown 解析
│       ├── templateLoader.js            # 模板加载
│       ├── imageHandler.js              # 图片处理
│       ├── inlineStyles.js              # 内联样式注入
│       ├── wechatApi.js                 # 微信 API 集成
│       ├── imageGen.js                  # Agnes AI 配图
│       └── convertWithImages.js         # 自动配图封装
├── public/                              # Web 前端（无构建）
│   ├── index.html
│   ├── style.css
│   └── app.js
├── server.js                            # Web 后端（Express）
├── api/index.js                         # Vercel 入口
├── config.json                          # 配置文件（密钥保存到这里）
└── package.json
```

## 快速开始

```bash
npm install
npm start            # 启动 Web 服务，监听 :3000
```

浏览器访问 `http://localhost:3000`。

### 第一件事：填写密钥

顶栏右侧齿轮 → 设置面板 → 填写：

| 字段 | 说明 |
|------|------|
| 微信公众号 AppID | 微信公众平台 → 开发 → 基本配置 |
| 微信公众号 AppSecret | 同上 |
| AI 配图密钥 | Agnes 平台 https://agnes-ai.com 申请（环境变量 `AGNES_API_KEY` 优先级更高） |

保存即写入 `config.json`，下一次请求立即生效。微信凭据未配置时，「发布」会降级为模拟发布（写入 `articles/published/`）。

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/health` | 健康检查 + 凭据配置摘要 |
| GET  | `/api/config` | 读取配置（密钥字段脱敏返回） |
| PUT  | `/api/config` | 更新配置（白名单字段） |
| GET  | `/api/templates` | 模板列表 |
| GET  | `/api/articles` | 文章列表（按 `updatedAt` 倒序） |
| GET  | `/api/articles/:slug` | 读取单篇（含正文） |
| POST | `/api/articles` | 新建文章 |
| PUT  | `/api/articles/:slug` | 更新文章（保存） |
| DELETE | `/api/articles/:slug` | 删除文章 |
| POST | `/api/render` | 渲染 Markdown → HTML（预览用） |
| POST | `/api/convert` | 导出 HTML 到 `articles/ready/` |
| POST | `/api/publish` | 推送到微信草稿箱（未配凭据时模拟发布） |
| POST | `/api/generate-image` | AI 生图（cover / inline） |

### `PUT /api/config` 字段白名单

```json
{
  "default_template": "minimal | tech | literary",
  "output_dir": "articles/ready",
  "image_strategy": "local-keep | local-warn | cdn-replace",
  "wechat": { "app_id": "wx...", "app_secret": "..." },
  "imageGen": {
    "enabled": true,
    "provider": "agnes",
    "model": "agnes-image-2.1-flash",
    "defaultSize": "1024x768",
    "apiKey": "sk-..."
  }
}
```

未知字段返回 400；非法值（如 `image_strategy` 不在枚举内）返回 400 并附带原因。密钥字段在 `GET` 时以 `••••••••` 占位回显。

## 排版模板

| 模板名 | 风格 | 适用场景 |
|--------|------|----------|
| minimal | 简约 | 通用文章 |
| tech | 科技 | 技术文章 |
| literary | 文艺 | 文学/随笔 |

## CLI（仍可用）

```bash
node scripts/convert.js articles/drafts/my-post.md --template minimal
node scripts/image-gen.js --cover "我的标题" --template tech
AGNES_API_KEY=sk-xxx node scripts/image-gen.js --cover "标题" --desc "蓝色科技感"
npm test                                # 冒烟测试
```

## Vercel 部署

```bash
vercel --yes
```

⚠️ Vercel 文件系统只读（运行时是 `/tmp`），文章和 `config.json` 不会持久保存——适合演示/分享。生产建议挂 Vercel KV 或用 Render/Railway 长驻型平台。

## 快捷键

- `Ctrl/Cmd + S` 保存
- `Ctrl/Cmd + N` 新建文章
- `Ctrl/Cmd + B` 加粗（在编辑器内）
- `Ctrl/Cmd + I` 斜体（在编辑器内）
- 右键文章项 → 删除
