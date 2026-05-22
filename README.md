# 青鸟智能术语管理系统 —— 智能术语管理器

<div align="center">

<img src="build/青鸟.png" alt="青鸟 Logo" width="120" />

**轻量、本地优先、AI 赋能的桌面端术语管理工具**

</div>

---

## 📖 概述

**青鸟智能术语管理系统** 是一款基于 Electron 构建的桌面端术语智能管理软件，以"短小精悍、本地优先、AI 赋能"为核心理念，为翻译工作者、学术研究者、技术文档工程师及本地化团队提供从术语抽取、多语言翻译对照到一致性质量管控的全链路解决方案。

软件完全运行于本地桌面环境，无需后台服务器支持。在此基础上，开放了可选的 AI 大模型接入能力（支持 OpenAI、DeepSeek、Anthropic 等），用户可按需启用智能术语抽取与翻译评析功能。

## ✨ 功能特性

### 🔍 术语抽取引擎（核心）

- **中文规则抽取** — 自研语义边界 + 后缀逆向扫描算法，精确识别专业术语，杜绝无效碎片
- **英文规则抽取** — n-gram（1~4 元语法）+ 停用词过滤 + 专业术语模式加权
- **AI 增强** — 大模型辅助术语判别、翻译建议、置信度评估
- **AI Vision PDF** — 支持图片型/扫描件 PDF，通过视觉大模型直接识别提取
- **混合策略** — 纯规则 / AI 增强 / 规则+AI 混合，三种模式自由切换
- **多格式支持** — TXT / DOCX / PDF / HTML / URL，含微信公众号适配

### 🗂️ 术语管理

- 完整的 CRUD 操作，支持批量选择与编辑
- 高级搜索：关键词、领域、语言、锁定状态、有无翻译等
- 术语锁定/解锁、收藏管理
- 树形领域分类路径（如"计算机科学技术 → 软件工程 → 人工智能"）
- 术语关系图谱（同义词 / 近义词 / 一词多义）
- 来源标注与权威性评分（1~5 分）

### 🌐 多语言翻译

- 以中文为母语核心，支持英、法、德、俄、日、西、韩、意、葡、阿共 10 种外语
- 强制"中→外"或"外→中"双向翻译方向
- 多译共存，标注来源（manual / ai / import / alignment）与置信度
- AI 翻译建议（单条或批量）

### ✅ 一致性检查

- 多译冲突检测
- 拼写变体检测（Levenshtein 编辑距离）
- 反向冲突双向校验
- 按领域范围定向检查

### 🤖 AI 集成

- 统一适配 OpenAI / DeepSeek / Anthropic
- 自定义端点、模型名称、Prompt 模板
- API 连接一键测试
- AI 不可用时自动降级为规则模式

## 🚀 快速开始

### 环境要求

- **Node.js** 18+
- **npm** 或 **yarn**

### 安装与运行

```bash
# 克隆仓库
git clone https://github.com/Peter-0480/term-manager.git
cd term-manager

# 安装依赖
npm install

# 启动开发模式
npm run dev
```

### 构建与打包

```bash
# 构建
npm run build

# 打包为 Windows 安装程序
npm run package
```

## 🛠 技术栈

| 层级 | 技术方案 |
|------|----------|
| 桌面框架 | Electron 28+（contextIsolation 安全隔离） |
| 前端 | React 18 + TypeScript + Ant Design 5 |
| 构建工具 | electron-vite |
| 数据库 | better-sqlite3（WAL 模式，本地单文件） |
| 文档解析 | mammoth（DOCX）、pdfjs-dist（PDF）、cheerio（HTML） |
| AI 集成 | OpenAI / DeepSeek / Anthropic 统一适配 |

## 📁 项目结构

```
term-manager/
├── src/
│   ├── main/                    # Electron 主进程
│   │   ├── index.ts             # 入口
│   │   ├── ipc-handlers.ts      # IPC 通道处理器
│   │   ├── database.ts          # SQLite 数据库
│   │   ├── database-memory.ts   # 内存数据库模式
│   │   ├── term-engine/         # 术语抽取引擎
│   │   ├── pdf-ai-extractor.ts  # AI Vision PDF 抽取
│   │   ├── pdf-polyfills.ts     # PDF 相关 polyfills
│   │   ├── html-content-extractor.ts  # HTML 正文提取
│   │   └── javascript-renderer.ts     # JS 渲染器
│   ├── preload/
│   │   └── preload.ts           # contextBridge 预加载
│   ├── renderer/                # React 渲染进程
│   │   ├── pages/               # 页面组件
│   │   ├── ipc-api.ts           # IPC 接口定义
│   │   └── ...
│   └── types/                   # TypeScript 类型定义
├── build/                       # 构建资源（含 Logo 图标）
├── package.json
├── LICENSE                      # MIT 许可证
└── README.md
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！请参阅 [CONTRIBUTING.md](./CONTRIBUTING.md) 了解详细的贡献流程与规范。

## 📄 许可证

本项目基于 [MIT 许可证](./LICENSE) 开源。

**Copyright (c) 2026 河外青鸟**

---

*Term Manager —— 让术语管理回归高效与可控。*
