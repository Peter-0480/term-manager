# 贡献指南

感谢你对 Term Manager 的关注！欢迎通过以下方式参与项目。

## 提交 Issue

- 使用 Bug 报告或功能建议标签
- 描述重现步骤、预期行为、实际行为
- 提供系统环境信息（操作系统、Node.js 版本）
- 附上相关截图或日志（注意移除敏感信息）

## Pull Request 流程

1. Fork 本仓库
2. 创建功能分支：`git checkout -b feature/your-feature`
3. 提交你的修改：`git commit -m 'feat: add some feature'`
4. 推送到远程分支：`git push origin feature/your-feature`
5. 提交 Pull Request 到 `main` 分支

## 代码规范

- TypeScript 文件使用项目 `tsconfig.json` 配置
- React 组件使用函数式组件 + Hooks
- 提交信息遵循约定式格式：`feat:` / `fix:` / `docs:` / `refactor:` / `test:` / `chore:`
- 新增功能请同步更新 README 中的相关说明

## 开发环境

```bash
git clone https://github.com/yourusername/term-manager.git
cd term-manager
npm install
npm run dev
```

## 测试

核心功能测试脚本位于项目根目录：

```bash
node test-extractor-fix.cjs       # 术语抽取引擎测试
node test-numbered-vocab.cjs      # 编号词汇处理测试
node test-optimized-regex.cjs     # 正则优化测试
node test-ai-file-extraction-fix.cjs  # AI 文件抽取测试
node end-to-end-test.cjs          # 端到端测试
```

## 行为准则

请遵守 [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) 中规定的行为准则。