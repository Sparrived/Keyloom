# Keyloom 发布与自动更新

Keyloom 使用 `v<version>` Git 标签触发 Windows 发布。版本必须在 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock` 中保持一致。

## 首次配置

1. 确保仓库的 `origin` 指向 GitHub。应用默认从 `Sparrived/Keyloom` 获取更新；如果仓库名称不同，只需修改 `src-tauri/tauri.conf.json` 中的 updater endpoint。若更换了签名密钥，再同步更新同文件里的公钥。
2. 生成 Tauri updater 签名密钥：

   ```powershell
   npx tauri signer generate -w "$HOME\.tauri\keyloom-updater.key"
   ```

3. 配置 GitHub Actions Secrets：

   - `TAURI_SIGNING_PRIVATE_KEY`：生成的 updater 私钥全文。
   - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`：生成私钥时使用的密码。

4. 将生成的 `.pub` 文件内容写入 `src-tauri/tauri.conf.json` 的 updater `pubkey`。

## 发布

先预览目标版本：

```powershell
npm run release -- --type patch --dry-run
```

确认工作区干净、位于 `main` 且已配置 `origin` 后发布：

```powershell
npm run release -- --type patch --yes
```

`--type` 支持 `patch`、`minor`、`major`，也可以使用 `--version 1.2.3`。添加 `--no-push` 可只创建本地提交和标签。

脚本会同步版本、执行前端和 Rust 测试、验证发布契约、构建前端、创建中文 release commit 和带注释标签，然后推送。当前首发流程不配置 Authenticode 证书，因此 Windows 会将安装器显示为“未知发布者”。标签工作流会发布：

- 未签名的 NSIS 安装器及 SHA-256；
- Tauri updater 使用的 NSIS 安装器签名 `.exe.sig`；
- 应用内更新使用的 `latest.json`。

Keyloom 安装包不再携带 Python 或 AMKR。首次初始化时若未发现 AMKR，应用优先执行 `uv tool install "auto-model-key-router[visitor]"`，没有 `uv` 时回退到 `pipx install`；后续 AMKR 更新也交给对应工具管理器。

本地开发构建会带着 updater 公钥，但不会生成签名更新包。只有 tag 工作流配好私钥后生成的正式安装包可以完成程序内更新。
