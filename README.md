# LLM-for-Zotero Batch Process

这是基于 [yilewang/llm-for-zotero](https://github.com/yilewang/llm-for-zotero) 修改的批量论文处理版本，归档版本为 **3.9.6.12**，修改及归档日期为 2026-09-15。原项目作者为 Yile Wang。本项目为独立修改版，并非上游官方发布。

这个版本主要解决一个很实际的问题：一次选中多篇 Zotero 文献，用同一个提示词依次处理，并把每篇论文的结果分别保存到对应的“论文会话”中。这样可以把一批论文交给插件顺序处理，不需要始终守在窗口前，之后也能回到各篇论文继续查看结果。

## 下载与安装

安装包位于：[`dist/llm-for-zotero-3.9.6.12-document-source-fix.xpi`](dist/llm-for-zotero-3.9.6.12-document-source-fix.xpi)。

在 Zotero 中打开“工具 → 插件”，点击齿轮菜单并选择“从文件安装插件”，然后选择上述 XPI，按提示重启 Zotero 即可。插件 ID 沿用上游版本，因此安装时会替换已经安装的同 ID 插件。更新前如果队列里还有尚未处理的任务，建议先处理完或自行记录。

本版本实际在 Windows / Zotero 7 环境下验证。Codex 模式需要另外安装、登录并配置可用的 Codex App Server；XPI 本身不包含 Codex CLI、账号凭据，也不会额外提供模型访问权限。

## 批量使用

1. 打开一篇论文的对话窗口，点击 Send 旁边的“加入批量队列”。切换到其他论文后再次点击，就可以继续往队列中添加论文。
2. 也可以直接在 Zotero 文库中多选论文，再点击“添加文库选中项”，或者把 Zotero 文献拖进队列。附件会自动归到所属论文并去重。本地 PDF 需要先导入 Zotero，再加入队列。
3. 从候选提示词中选择 Summarize、Key Points、Methodology、Limitations、Diagram，或者已经保存的自定义提示词，例如 `My_Summary_Prompt`。在对话窗口中新建的提示词也会同步到候选列表。本归档不包含任何用户私人提示词。
4. 选择模型和推理力度后，点击“开始 / 继续”。模型列表来自 Codex 当前提供的可用模型目录，实际能够使用哪些模型仍取决于本地服务器和账号权限。
5. 队列始终按顺序一次处理一篇论文。处理过程中可以切换到其他论文，不会影响后台任务继续执行。任务完成后，可通过“打开论文会话”回到对应论文查看保存的结果。

| 操作 | 实际行为 |
| --- | --- |
| 开始 / 继续 | 启动等待中的任务并按顺序执行；如果启动失败，会显示具体原因 |
| 本篇完成后暂停 | 让当前论文执行完，再暂停后续任务 |
| 停止当前及后续 | 中止当前请求，同时取消后面仍在等待的任务 |
| 重新排队 | 重新执行失败或已取消的任务；失败任务不会自行重复运行 |
| 打开论文会话 | 定位到对应论文并打开已经保存的会话 |
| 移除等待条目 | 从队列中删除尚未开始的任务 |

队列面板支持拖动、缩放和折叠。模型与推理力度会在任务启动时确定；如果想修改后续任务的配置，先暂停队列，调整完成后再继续即可。

## 相对上游发行版的修改

- 加入顺序批量处理、论文追加与去重、提示词同步、模型与推理力度选择，以及每篇论文独立保存会话并回读确认等功能。
- 调整后台请求与论文上下文的归属关系，避免仅仅因为切换论文或对话窗口就触发大量 `[Cancelled]`。
- 修正文档提交阶段的论文来源解析。对于没有集合范围的 `read_full`，现在会使用已经捕获的论文上下文解析来源，从而处理“全文已经读取，但仍出现 `frozen paper sources unresolved` / `requested document was not finalized`”这一类问题；原有的前置动作和正文证据检查仍然保留。
- 单篇论文失败、被阻断或单次请求被取消时，会记录错误并继续处理下一篇；如果用户主动选择暂停或停止，则仍会按用户操作终止队列推进。
- 为 Codex 语义解释保留更合理的等待时间，并改进 `actions`、`skill_binding` 解析失败后的纠正重试和诊断；写入授权检查没有取消。
- 对特定输入流中断提供一次有界恢复，同时调整 Zotero MCP 工具的等待时间和预检缓存，减少长篇读取超过 300 秒后失败的情况。
- 调整委托操作的状态显示。模型列表会适配服务器实际返回的可用型号，但插件本身不会让旧服务器获得原本不支持的模型。

## 验证与限制

最终版本曾使用 **GPT-5.6 Sol / Low** 和原始自定义长提示词连续处理两篇论文。实测确认队列能够自动进入下一篇，结果能够持久保存，并且重新打开对应论文会话后仍可访问。最终归档版没有再次进行 Luna / Max 实测。

文档来源校验的原始报错已经通过真实函数回归测试复现，并验证了对应修复。上述模型实测只代表已经覆盖的实际使用路径，并不意味着所有模型和所有生成路径都经过完整测试。自动测试使用模拟的 Zotero、DOM 和模型环境，不会操作真实文库，也不会调用付费 API。

**当前队列只保存在内存中。** 如果关闭 Zotero 窗口或更新插件，尚未执行的队列条目会丢失；已经保存到论文会话中的结果不会受到影响。这个版本暂未实现重启后的队列恢复。

`manifest.json` 仍然使用上游的自动更新地址。因此安装本修改版后，建议在 Zotero 插件管理界面中留意自动更新设置，避免后续被上游版本直接覆盖。

## 目录与源码说明

```text
README.md
LICENSE                         上游 AGPL v3 许可证
NOTICE.md                       来源与修改说明
src/extension/                  当前插件完整展开目录
  content/scripts/llmforzotero.js  实际修改的可读 JavaScript bundle
  manifest.json                 插件元数据及版本
  content/、locale/、scripts/等   插件运行所需的其他资源
dist/                          已验证的 XPI 安装包
tests/                         9 个离线回归测试
tests/fixtures/                原发行版脚本，仅用于复现修改前行为
scripts/build.ps1              重新打包 XPI
scripts/test.ps1               语法检查及回归测试
docs/VALIDATION.md             验证范围
docs/GITHUB.md                 GitHub 上传步骤
```

这里保存的是本次实际编辑、运行和打包所使用的 JavaScript 与相关资源，**并不是上游完整的 TypeScript 开发仓库**。如果只是重新打包当前版本，不需要执行 `npm install`，也不需要重新编译上游工程。需要完整 TypeScript 源码时，请直接查看上游仓库；当前上游 `main` 也不能视为这个归档包的精确构建来源。

`tests/fixtures/original-llmforzotero.js` 保存了修改前的发行版脚本，用于流恢复、MCP 和文档来源等回归测试的对照。两项包含私人故障记录的旧测试没有放入公开归档。仓库中也不包含 Zotero 数据库、个人会话、队列清单、API 密钥或私人提示词。

## 测试与打包

在仓库根目录打开 PowerShell 即可运行测试和重新打包。测试需要 Node.js（归档时使用 v24.19.0）；打包使用 PowerShell/.NET：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\test.ps1
powershell -ExecutionPolicy Bypass -File .\scripts\build.ps1
```

重新打包后会生成 `build/llm-for-zotero-3.9.6.12.xpi`，不会覆盖 `dist/` 中保存的已验证安装包。重新生成的 ZIP/XPI 压缩字节可能不同，但插件文件内容相同。

## 来源与许可证

本仓库保留上游作者信息和第三方声明，并继续按照上游的 GNU Affero General Public License v3 发布。具体内容见 [LICENSE](LICENSE) 和 [NOTICE.md](NOTICE.md)。上游许可证原文可在 [yilewang/llm-for-zotero 的 LICENSE](https://github.com/yilewang/llm-for-zotero/blob/main/LICENSE) 中查看。

GitHub 上传步骤见 [docs/GITHUB.md](docs/GITHUB.md)。
