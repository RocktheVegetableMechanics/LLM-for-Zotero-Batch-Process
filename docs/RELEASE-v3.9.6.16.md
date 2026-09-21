# v3.9.6.16 — 批量动作解释恢复与字段级诊断

日期：2026-09-21。针对 GPT-5.6 Luna / Max 批量分析中 `unparseable: actions` 的恢复能力进行修复。按要求不修改 README.md。

## 已定位的问题

`actions` 是动作列表及多个顶层语义字段校验失败共用的阶段名称。原解析器只返回 null，无法区分非法操作名、coverage、parameters、scope、wantedSections 或 writeDisposition 等问题；重试仅得到通用提示。解释过程共用两次机会，若先修复其他问题、第二次才发生动作格式错误，就没有进一步纠正机会。

用户本次日志没有包含被拒绝的模型 JSON，因此不能确定具体触发字段，也不能声称已复现其原始 Luna 输出。

## 修改

- 在现有解析器的原拒绝分支中返回字段级诊断，不另建校验框架，不更改可接受动作与授权条件。
- 重试收到具体字段及修正规则，例如 actionIntents[0].coverage 只能是 one/some/all；exhaustive 属于阅读覆盖字段。
- 当第二次仍是动作格式失败时，最多再允许一次纠正，总请求数不超过 3；取消与持续校验失败仍停止授权。
- 增加全文分析 read_full 的格式示例，明确它与 paper_read 工具、submit_document 工具，以及 decisions.reading.coverage 的区别。示例本身不赋予读取或写入权限。
- 最终失败时，普通会话和批量执行路径都会显示具体动作字段诊断，便于进一步定位模型输出。
- 不删除无效动作以伪造成功，不自动将 writeDisposition 改为 required，不扩大文献范围。

## 验证

12 个离线回归测试文件及 JavaScript 语法检查通过。新增用例直接执行实际解析器和 SemanticIntentService，覆盖 12 类非法字段、具体诊断驱动的纠正、写入目标与授权保持不变、第三次纠正、持续失败、取消及旧调用兼容。

本轮没有重跑真实 Luna / Max 批量模型任务，没有安装到当前 Zotero。修改解决已确认的诊断缺失及纠正机会不足，无法保证任意模型持续返回非法 JSON 时都能恢复。

## 安装与来源

安装包：llm-for-zotero-3.9.6.16.xpi。通过 Zotero 插件管理器从文件安装。升级前先处理或记录内存中的未完成队列。

沿用上游作者与 GNU AGPL v3 许可证。版本以 manifest.json 及本说明为准，README.md 按要求保留原样。
