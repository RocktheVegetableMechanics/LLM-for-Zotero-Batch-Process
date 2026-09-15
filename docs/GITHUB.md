# 上传到 GitHub

1. 登录 GitHub，新建空仓库，建议命名 `LLM-for-Zotero-Batch-Process`。不要勾选初始化 README、.gitignore 或许可证：本目录已经提供这些文件。
2. 安装 Git，在 PowerShell 执行下列命令，把 `YOUR_USERNAME` 替换为你的 GitHub 用户名：

```powershell
Set-Location 'G:\Proj_MyVibe\LLM-for-Zotero-Batch-Process'
git init
git add .
git commit -m "Archive llm-for-zotero 3.9.6.12 batch processing version"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/LLM-for-Zotero-Batch-Process.git
git push -u origin main
```

若 Git 首次提交提示缺少身份，先执行 `git config user.name "你的名字"` 与 `git config user.email "你的 GitHub 提交邮箱"`，然后重新提交。推送时按 Git Credential Manager 的浏览器登录提示完成认证，不要把令牌写进仓库。

以上初始化步骤只需执行一次。之后更新通常使用 `git add .`、`git commit -m "说明修改"`、`git push`。

3. 可在仓库的 Releases 页面创建 `v3.9.6.12`，标题注明“批量处理修改版”，将 `dist/llm-for-zotero-3.9.6.12-document-source-fix.xpi` 拖到附件区。发布说明写明功能、已知限制及源代码就在同一仓库。目录中的 XPI 也会随本次 Git 提交上传；Release 提供更直观的安装入口。

保留 README、NOTICE、LICENSE 和源码中的原作者声明，不要把上游项目标成自行原创，也不要另选不相容的许可证。归档操作没有替你创建 GitHub 仓库或推送文件。

官方操作说明：https://docs.github.com/en/migrations/importing-source-code/using-the-command-line-to-import-source-code/adding-locally-hosted-code-to-github
