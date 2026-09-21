# 来源与修改声明

本归档基于 Yile Wang 的 llm-for-zotero 发行版，保留原作者及插件元数据。
上游：https://github.com/yilewang/llm-for-zotero

2026-09-15：归档本地修改版 3.9.6.12。修改涉及批量队列、交互、会话持久保存、后台请求归属、文档来源解析、语义解释恢复、流恢复及 MCP 等待配置。具体说明见 README.md。

2026-09-21：修订 3.9.6.16，并基于上游正式 v3.9.9（提交 4d20b41442c89dfe047fce7d2627928763be558a）开发 3.9.9.1。具体修改、迁移决策和验证记录见 docs/。

development/ 是 3.9.9.1 的完整 TypeScript 工程；src/extension/ 是对应构建输出。legacy/3.9.6.16/ 保存旧版修订源码和回归测试，其中 tests/fixtures/original-llmforzotero.js 为修改前发行版的测试素材，不属于最终插件运行内容。

LICENSE 从上游 main/LICENSE 于 2026-09-15 获取，内容为 GNU AGPL v3。第三方代码仍保留原有声明，例如 src/extension/content/vendor/mermaid/LICENSE.txt。此归档不代表上游官方发布。
