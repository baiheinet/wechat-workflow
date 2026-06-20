# WeChat Workflow

微信公众号写作工作台。Notion 风格 WYSIWYG 编辑器 + 持久 AI 助理，一站式完成 **写作 → 排版 → 配图 → 润色 → 发布 → 复盘**。

线上地址：https://wechat-workflow.vercel.app

[![zread](https://img.shields.io/badge/Ask_Zread-_.svg?style=for-the-badge&color=00b0aa&labelColor=000000&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB3aWR0aD0iMTYiIGhlaWdodD0iMTYiIHZpZXdCb3g9IjAgMCAxNiAxNiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTQuOTYxNTYgMS42MDAxSDIuMjQxNTZDMS44ODgxIDEuNjAwMSAxLjYwMTU2IDEuODg2NjQgMS42MDE1NiAyLjI0MDFWNC45NjAxQzEuNjAxNTYgNS4zMTM1NiAxLjg4ODEgNS42MDAxIDIuMjQxNTYgNS42MDAxSDQuOTYxNTZDNS4zMTUwMiA1LjYwMDEgNS42MDE1NiA1LjMxMzU2IDUuNjAxNTYgNC45NjAxVjIuMjQwMUM1LjYwMTU2IDEuODg2NjQgNS4zMTUwMiAxLjYwMDEgNC45NjE1NiAxLjYwMDFaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00Ljk2MTU2IDEwLjM5OTlIMi4yNDE1NkMxLjg4ODEgMTAuMzk5OSAxLjYwMTU2IDEwLjY4NjQgMS42MDE1NiAxMS4wMzk5VjEzLjc1OTlDMS42MDE1NiAxNC4xMTM0IDEuODg4MSAxNC4zOTk5IDIuMjQxNTYgMTQuMzk5OUg0Ljk2MTU2QzUuMzE1MDIgMTQuMzk5OSA1LjYwMTU2IDE0LjExMzQgNS42MDE1NiAxMy43NTk5VjExLjAzOTlDNS42MDE1NiAxMC42ODY0IDUuMzE1MDIgMTAuMzk5OSA0Ljk2MTU2IDEwLjM5OTlaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik0xMy43NTg0IDEuNjAwMUgxMS4wMzg0QzEwLjY4NSAxLjYwMDEgMTAuMzk4NCAxLjg4NjY0IDEwLjM5ODQgMi4yNDAxVjQuOTYwMUMxMC4zOTg0IDUuMzEzNTYgMTAuNjg1IDUuNjAwMSAxMS4wMzg0IDUuNjAwMUgxMy43NTg0QzE0LjExMTkgNS42MDAxIDE0LjM5ODQgNS4zMTM1NiAxNC4zOTg0IDQuOTYwMVYyLjI0MDFDMTQuMzk4NCAxLjg4NjY0IDE0LjExMTkgMS42MDAxIDEzLjc1ODQgMS42MDAxWiIgZmlsbD0iI2ZmZiIvPgo8cGF0aCBkPSJNNCAxMkwxMiA0TDQgMTJaIiBmaWxsPSIjZmZmIi8%2BCjxwYXRoIGQ9Ik00IDEyTDEyIDQiIHN0cm9rZT0iI2ZmZiIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIvPgo8L3N2Zz4K&logoColor=ffffff)](https://zread.ai/baiheinet/wechat-workflow)
---

## 功能

- **WYSIWYG 编辑器**：所见即所得，编辑时即看到最终微信渲染效果
- **三套排版模板**（minimal / tech / literary），顶栏一键切换，编辑器实时重渲染
- **AI 助理**（右侧面板）：
  - `/image <描述>` — AI 配图（封面 / 行内图）
  - `/polish` — 润色选中文本（也可点浮动工具条的「✨ 重写」）
  - `/research <主题>` — 资料搜集
  - 多轮对话，SSE 流式输出，按文章分组持久化
- **暗色模式**（顶栏 🌙 切换）
- **文章管理**：左侧文档树，CRUD，自动保存（1.5s debounce）
- **选题管理**：在文档树里创建/编辑/拖拽状态
- **发布**：直接推微信草稿箱（未配凭据时降级为模拟）
- **Vercel Blob 持久化**：所有数据存云端，冷启动不丢

---

## 架构

```
wechat-workflow/
├── server.js                # Express 后端：所有 API + Vercel 适配
├── api/index.js             # Vercel serverless 入口（代理到 server.js）
├── public/                  # 前端（无构建，纯静态）
│   ├── index.html           # 三栏布局骨架
│   ├── style.css            # design tokens（颜色/字体/间距）+ 暗色模式
│   ├── app.js               # 初始化编排（主题、保存、发布、模板）
│   ├── api.js               # API 客户端（含 SSE 流式 chat）
│   ├── tree.js              # 文档树（articles + topics）
│   ├── editor.js            # WYSIWYG contenteditable + 浮动工具条
│   └── chat.js              # AI 助理面板
├── templates/               # 排版模板（JSON，含 inline styles）
│   ├── minimal.json
│   ├── tech.json
│   └── literary.json
├── scripts/                 # CLI 共享底层（仍可用）
│   ├── convert.js           # CLI: 转换单篇
│   ├── test.js              # 冒烟测试
│   └── lib/                 # 模板加载、markdown→html、WeChat API、AGNES 配图
├── vercel.json              # Vercel 路由配置
├── config.json              # 本地开发配置（Vercel 上忽略，env vars 优先）
└── package.json
```

---

## 快速开始

### 本地开发

```bash
npm install
npm start                   # 启动 Web 服务，监听 :3000
```

浏览器访问 `http://localhost:3000`。

CLI 仍然可用：

```bash
npm test                                    # 冒烟测试（必过）
node scripts/convert.js path/to/post.md     # 转换单篇
```

### Vercel 部署

推送到 GitHub main 分支即自动部署。Vercel 项目需配置：

| 环境变量 | 说明 | 必填 |
|---------|------|------|
| `AGNES_API_KEY` | AGNES AI 统一 key（文本 + 图像），从 https://agnes-ai.com 申请 | 是 |
| `WECHAT_APP_ID` | 微信公众号 AppID | 否（未配则发布降级模拟） |
| `WECHAT_APP_SECRET` | 微信公众号 AppSecret | 否 |
| `DEFAULT_TEMPLATE` | 默认模板（minimal/tech/literary），默认 `minimal` | 否 |
| `IMAGE_STRATEGY` | 图片策略（local-keep/local-warn/cdn-replace），默认 `cdn-replace` | 否 |
| `OUTPUT_DIR` | 导出目录，默认 `articles/ready` | 否 |

> AGNES API 是 OpenAI 兼容协议，所以一个 key 既能调对话也能调生图。后端用 `https://apihub.agnes-ai.com/v1/chat/completions` 走对话，用 `/v1/images/generations` 走配图。

### 持久化

- **Vercel Blob**（推荐生产）：连接 Vercel 项目里的 Blob Store，OIDC 自动鉴权，所有文章/选题/图片/配置存云端
- **本地 fs**：`articles/` 和 `assets/` 目录（仅开发用，Vercel 部署不持久）

未配 Blob Store 时 `/api/articles` 等返回 503 明确错误，不静默 fallback。

---

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | `/api/health` | 健康检查 + 凭据配置摘要 |
| GET  | `/api/config` | 读取配置（密钥脱敏） |
| PUT  | `/api/config` | 更新配置 |
| GET  | `/api/templates` | 模板列表 |
| GET  | `/api/articles` | 文章列表（按 updatedAt 倒序） |
| GET  | `/api/articles/:slug` | 读单篇（含正文） |
| POST | `/api/articles` | 新建文章 |
| PUT  | `/api/articles/:slug` | 更新文章 |
| DELETE | `/api/articles/:slug` | 删除文章 |
| GET  | `/api/articles/:slug/assets` | 文章关联图片列表 |
| GET  | `/api/topics` | 选题列表 |
| GET  | `/api/topics/:slug` | 读单条 |
| POST | `/api/topics` | 新建选题 |
| PUT  | `/api/topics/:slug` | 更新选题 |
| DELETE | `/api/topics/:slug` | 删除选题 |
| GET  | `/api/topics/meta` | 选题元信息（状态/优先级枚举） |
| POST | `/api/render` | 渲染 Markdown → HTML（`mode: 'editor'` 返回 WYSIWYG 模式 + CSS） |
| POST | `/api/convert` | 导出 HTML 到 ready 目录 |
| POST | `/api/publish` | 推微信草稿箱（未配凭据时模拟） |
| POST | `/api/generate-image` | AI 配图（cover/inline） |
| POST  | `/api/chat/stream` | AI 对话 SSE 流式（OpenAI 兼容协议） |
| POST | `/api/chat/skills/polish` | 润色文本 |
| POST | `/api/chat/skills/research` | 资料搜集 |
| GET  | `/api/stats` | 数据复盘（阅读/分享/收藏） |

---

## 排版模板

`templates/<name>.json` 定义每套模板的 inline styles（h1-h4、p、strong、em、blockquote、code、pre、ul/ol/li、img、table 等）。

| 模板名 | 风格 | 适用 |
|--------|------|------|
| minimal | 简约 | 通用文章 |
| tech | 科技 | 技术文章 |
| literary | 文艺 | 文学/随笔 |

新增模板：复制一份 JSON 改 styles，重启服务即可（`/api/templates` 自动列出）。

---

## 快捷键

- `Ctrl/Cmd + S` 保存

---

## 路线图

- [x] Notion 风格 WYSIWYG 编辑器
- [x] AI 助理面板（对话/润色/配图/资料）
- [x] 模板实时切换
- [x] 暗色模式
- [x] 选题管理
- [x] Vercel Blob 持久化
- [ ] 多用户/权限
- [ ] 协作编辑（实时同步）
- [ ] 文章版本历史
