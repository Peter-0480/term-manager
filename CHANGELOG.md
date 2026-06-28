# Changelog

## [0.1.0] - 2026-06-28

### 新增 - 错误分类系统 (ExtractionError)

- 新增 src/types/errors.ts：完整的网页抽取错误分类体系
  - 20+ 细粒度错误码，覆盖 URL/网络/DNS/SSL/HTTP/CAPTCHA/反爬/内容长度/AI 等场景
  - ExtractionErrorClass 自定义 Error 子类，支持通过 IPC 安全序列化传递到渲染进程
  - classifyExtractionError() 智能分类器，根据错误消息关键词自动识别错误类型
  - getErrorSummary() 生成用户友好的错误摘要和排查建议

### 增强 - 全链路结构化错误处理

- advanced-fetcher.ts：HTTP 错误返回结构化信息（errorCode / errorSummary / errorSuggestion / isRetryable）
- ipc-handlers.ts：新增 toStructuredError() 统一转换器，所有抽取 IPC 通道错误均返回结构化响应
- javascript-renderer.ts：JS 渲染回退失败时返回分类错误详情
- term-engine/index.ts：URL 抽取全链路错误分类，HTML 内容过短检测，AbortError 超时特殊处理
- TermManager.tsx：新增 showExtractionError() 前端错误展示函数，统一展示带排查建议的结构化错误提示

### 增强 - 导出功能

- 支持 CSV 和 JSON 两种导出格式
- 支持「当前页面」与「全部结果（含筛选）」两种导出范围
- 导出文件对话框名称自动匹配所选格式
- CSV 支持中文字符，JSON 包含完整数据结构

### 清理

- 移除废弃的测试/调试文件
- .gitignore 新增 fix-*.cjs 规则，排除临时修补脚本