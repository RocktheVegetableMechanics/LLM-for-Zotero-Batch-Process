# 构建与检查

需 Node.js/npm 和 PowerShell。仓库根目录执行：

    cd development
    npm ci
    npm run typecheck
    npm run test:unit -- --timeout 10000
    npm run build

完整工作流测试使用独立 Zotero profile 与一次性文库：设置 ZOTERO_PLUGIN_ZOTERO_BIN_PATH 为本机 zotero.exe 路径，执行 npm run test:workflow。不要向测试 profile 配置真实同步账号。

scripts/build.ps1 从 development/ 构建并同步 src/extension/ 和 dist/ 的新版 XPI。scripts/test.ps1 执行旧版回归和新版类型/单元检查；加 -Workflow 执行原生工作流。

旧版可独立使用 legacy/3.9.6.16/scripts/build.ps1 与 test.ps1 重建和测试。相同版本升级请手动安装 XPI 后重启；升级前让队列完成或暂停。队列 JSON 含论文标题及用户提示词，应按个人文库数据保管，不提交到 GitHub。
