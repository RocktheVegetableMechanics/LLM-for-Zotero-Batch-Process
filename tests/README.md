# 回归测试位置

- `legacy/3.9.6.16/tests/`：保留并扩展旧版回归，直接测试旧版展开源码。
- `development/test/`：上游 TypeScript 单元测试和新增批量队列/断流测试。
- `development/test-workflows/`：一次性 Zotero profile 中的原生工作流测试。
- 仓库根 `scripts/test.ps1` 运行旧版回归和新版类型/单元检查；`-Workflow` 追加原生工作流。

真实模型测试的范围、结果和限制记录在 `docs/VALIDATION.md`。单元/模拟测试不等同于真实模型分析通过。
