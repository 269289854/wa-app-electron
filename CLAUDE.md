# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

WA App 的 Electron + React + Vite + TypeScript 桌面客户端。Electron 主进程作为安全代理，把 renderer 的所有请求转发到远端或本地服务，并在主进程注入访问密码与 SMS 平台密钥，避免在浏览器环境暴露凭据。

## Commands

```sh
npm install
npm run dev              # Vite dev server (127.0.0.1:5173) + Electron，主进程通过 VITE_DEV_SERVER_URL 加载
npm run build            # typecheck → vite build (dist/) → build:electron (dist-electron/)
npm run dist             # build + electron-builder，产物输出到 release/
npx electron-builder --dir   # 只生成 unpacked 包（release/win-unpacked/），桌面 smoke 依赖它
npm run typecheck        # 同时校验 renderer 与 electron 两套 tsconfig
npm run lint             # eslint .（flat config）
npm run test             # vitest run
npm run test -- src/api.test.ts   # 跑单个测试文件
```

### 烟测（PowerShell，Windows）

```powershell
$env:WA_APP_ELECTRON_SMOKE_PASSWORD = "<访问密码>"
npm run smoke:remote-api    # 只读校验线上 /api/wa/...
npm run smoke:electron      # 需要 release/win-unpacked/WA App.exe，用临时 userData 校验生产包
npm run smoke:mock-ui       # 启本地 mock /api/wa，校验有账号数据时全部 UI 链路
Remove-Item Env:\WA_APP_ELECTRON_SMOKE_PASSWORD -ErrorAction SilentlyContinue
```

## Architecture

### 双 TypeScript 工程边界

仓库有两套互不共享的 tsconfig，改动时需注意目标：

- 根 `tsconfig.json`：renderer（Vite/React，输出到 `dist/`），`src/**`。
- `electron/tsconfig.json`：主进程，`module: NodeNext`，输出到 `dist-electron/`，`electron/**`。`main` 字段指向 `dist-electron/main.js`。
- `npm run typecheck` 会同时编译校验两者，不要只依赖编辑器单边检查。

### 主进程 ↔ Renderer 的唯一通道：preload 桥

[electron/preload.ts](electron/preload.ts) 用 `contextBridge` 暴露受控 API（`window.waConfig` / `waApi` / `waService` / `smsPlatform` / `smsCancelQueue` / `openAIPhone` 等），`contextIsolation: true`、`nodeIntegration: false`。renderer 绝不直接访问 Node 或网络，一切走 `ipcRenderer.invoke`。新增桌面能力时，必须在 [electron/main.ts](electron/main.ts) 注册对应的 `ipcMain.handle` 并在 preload 里补暴露。

注意 `window.smsbower` 是 `window.smsPlatform` 的 legacy 别名（[preload.ts:83](electron/preload.ts)），main 里 `smsbower:*` 与 `sms-platform:*` 两套通道指向同一组处理函数。

### 服务模式与请求注入

[main.ts](electron/main.ts) 支持两种 `mode`：

- `remote`（默认）：连接 `https://wa.yizhimeng.uk`，地址由配置决定。
- `local`：spawn 打包内 `resources/wa-app-service/wa-app-service(.exe)`，数据目录默认 `userData/wa-app-data`；该二进制当前不在仓库，需后续放入 `resources/`。

`requestJSON`/`requestAsset` 在每次请求注入 `Authorization: Basic wa:<password>`，密码来自加密存储。`/api/wa/health` 不可用时回退到 `/healthz`。

### 凭据存储

[electron/config.ts](electron/config.ts)：配置文件 `userData/config.json`，密码、SMSBower/Hero-SMS API key 用 Electron `safeStorage` 加密后存为 `encryptedPassword`/`encryptedApiKey`/`encryptedHeroSMSApiKey`。`publicConfig` 只返回 `hasPassword`/`hasApiKey` 等布尔位，绝不回传明文。生产白屏/明文回归是 smoke 重点防范项。

### SMS 平台与取消队列

- [electron/sms-platforms.ts](electron/sms-platforms.ts)：统一 `smsbower` / `hero-sms` 两个 provider，底层都复用 [smsbower.ts](electron/smsbower.ts) 的 `SMSBowerClient`（Hero-SMS 走不同 endpoint 与 `getPrices` action）。
- [electron/sms-cancel-queue.ts](electron/sms-cancel-queue.ts)：SQLite 持久化（`userData/sms-cancel-queue.sqlite`）的取消队列服务，主进程启动时拉起，到期调用 provider 的 `setStatus(id, 8)` 取消激活。

### OpenAI 手机校验本地桥

主进程在 `127.0.0.1:17391` 起一个 HTTP 桥（[main.ts](electron/main.ts) `openAIPhoneBridge`）。renderer 发起校验后挂起 promise，浏览器扩展通过 `GET /openai-phone-check/task` 取任务、`POST /openai-phone-check/result` 回填结果。renderer 侧由 [src/openai-phone-check.ts](src/openai-phone-check.ts) 归一化结果。

### Renderer 结构

`src/main.tsx` 是单文件 React 入口（HashRouter + TanStack Query），UI/业务逻辑集中在此；领域逻辑拆到 `src/*.ts`（`api.ts`、`phone-input.ts`、`result-model.ts`、`smsbower-countries.ts`、`openai-phone-check.ts`、`types.ts`），各自带 `*.test.ts`。

### 打包

`electron-builder` 配置在 `package.json` 的 `build` 字段：Windows `nsis+zip`，macOS `dmg+zip`，Linux `AppImage+deb`，产物输出到 `release/`。`extraResources` 会把 `resources/` 整目录打进包（供 `local` 模式查找 service 二进制）。Windows 已验证 `--dir` 可出包，macOS/Linux 产物需对应平台或 CI 验证。

## 开发约定

- ESLint：`@typescript-eslint/no-explicit-any` 关闭；`no-unused-vars` 忽略 `_` 前缀参数。
- 测试与源码同目录，`*.test.ts`，使用 vitest。
- 访问密码、SMS API key、`WA_APP_ELECTRON_SMOKE_PASSWORD` 等敏感值只能来自本机配置或运行时环境变量，不得写入源码、README 或提交历史。
- 主进程环境变量（调试/烟测用）：`WA_APP_ELECTRON_MOCK_SMSBOWER=1`、`WA_APP_ELECTRON_MOCK_OPENAI_PHONE={rate_limit|session_expired}`、`WA_APP_ELECTRON_USER_DATA_DIR=<path>`、`WA_APP_ELECTRON_TEST_CONFIG=<json>`、`WA_APP_OPEN_DEVTOOLS=1`。
