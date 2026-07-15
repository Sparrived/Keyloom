# Keyloom

![Keyloom](https://img.shields.io/badge/Keyloom-desktop%20control%20plane-111827?style=for-the-badge)
![Platform](https://img.shields.io/badge/platform-Windows-0078D4?style=flat-square&logo=windows)
![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=111827)

Keyloom 是 [Auto Model Key Router](https://github.com/Sparrived/auto-model-key-router)（AMKR）的 Windows 桌面控制面。

它把本机模型供应商、Key、模型池、路由策略和运行指标集中到一个轻量桌面应用中，让你无需手动编辑配置文件或记忆服务命令，就能完成日常管理。

> 当前版本：`0.1.4`。项目仍在快速迭代中，正式发布以 [GitHub Releases](https://github.com/Sparrived/Keyloom/releases) 为准。

## 功能

- **概览与健康状态**：查看 AMKR 连接状态、版本、当前配置和实时用量趋势。
- **供应商管理**：管理上游地址、API Key、模型池和供应商路由路径。
- **模型路由**：创建模型别名，配置多个上游目标和路由模式。
- **统一模型**：为常用请求配置主模型、回退模型、图像模型和推理强度。
- **活动与日志**：查看最近一小时的请求、Token、延迟、错误和服务日志。
- **服务生命周期**：启动、停止、重启 AMKR，并注册登录启动或系统级 Windows 服务。
- **集成状态**：查看 Codex 与 Claude Code 的本机配置发现状态。
- **桌面挂件**：可选的 AMKR 状态与用量悬浮窗口。
- **配置迁移**：导出或导入可迁移的 AMKR 配置。
- **自动更新**：支持 Keyloom 与 AMKR 的版本检查；正式安装包支持应用内更新。

## 快速开始

### 使用安装包

从 [Releases](https://github.com/Sparrived/Keyloom/releases) 下载最新的 Windows 安装包并运行。Keyloom 首次启动时会自动查找本机 AMKR 配置；如果尚未安装 AMKR，可通过 `uv` 或 `pipx` 完成初始化。

Keyloom 不会把 Python 或 AMKR 打包进安装器。首次初始化时，安装顺序为：

1. `uv tool install "auto-model-key-router[visitor]"`
2. 如果没有 `uv`，回退到 `pipx install`

### 从源码运行

环境要求：

- Windows 10 或更高版本
- Node.js 18+
- Rust stable 与 Cargo
- Tauri 2 的 Windows 开发依赖
- 可选：`uv` 或 `pipx`，用于初始化 AMKR

```powershell
git clone https://github.com/Sparrived/Keyloom.git
cd Keyloom
npm install
npm run dev
```

启动 Tauri 桌面开发模式：

```powershell
npx tauri dev
```

## 开发命令

| 命令 | 用途 |
| --- | --- |
| `npm run dev` | 启动 Vite 前端开发服务器 |
| `npx tauri dev` | 启动 Tauri 桌面开发模式 |
| `npm run build` | 类型检查并构建前端 |
| `npm test -- --run` | 运行单元测试 |
| `npm run test:e2e` | 运行 Playwright 端到端测试 |
| `npm run test:all` | 运行完整前端测试和端到端测试 |
| `cargo test --manifest-path src-tauri/Cargo.toml` | 运行 Rust 测试 |
| `npm run release -- --type patch --dry-run` | 预览发布版本变更 |

## 工作方式

```text
┌─────────────────────┐       Tauri IPC       ┌────────────────────────┐
│  Keyloom React UI   │ ◄───────────────────► │  Rust desktop runtime  │
│  状态 / 配置 / 指标  │                       │  discovery / service    │
└─────────────────────┘                       └───────────┬────────────┘
                                                          │
                                                          ▼
                                              ┌────────────────────────┐
                                              │  本机 AMKR service       │
                                              │  config / API / metrics  │
                                              └────────────────────────┘
```

- 前端使用 React + TypeScript，负责界面、交互和状态刷新。
- Rust/Tauri 负责本机服务发现、Windows 服务控制、安全 IPC、配置读写和 SQLite 指标访问。
- Keyloom 通过 AMKR 的本机 API 工作，不直接代理模型请求，也不存储明文 Key；界面默认展示脱敏信息和 Key 指纹。

## 发布

发布由 `v<version>` Git 标签触发。版本号需要在 `package.json`、`package-lock.json`、`src-tauri/tauri.conf.json` 和 Cargo 文件中保持一致。

```powershell
# 预览 patch 版本发布
npm run release -- --type patch --dry-run

# 确认后执行发布
npm run release -- --type patch --yes
```

完整的签名密钥配置、GitHub Actions Secrets 和自动更新说明见 [`docs/releasing.md`](docs/releasing.md)。

## 项目结构

```text
src/                 React 应用与功能页面
src/api/              AMKR IPC/API 调用封装
src-tauri/src/        Tauri、Rust 服务控制与 AMKR 集成
tests/                发布契约与端到端辅助测试
docs/                 设计、实现计划与发布文档
```

## 相关项目

- [Auto Model Key Router](https://github.com/Sparrived/auto-model-key-router)：Keyloom 管理的本机路由服务。
- [Tauri](https://tauri.app/)：桌面应用运行时。

## 许可证

本项目采用 [MIT License](LICENSE) 授权。
