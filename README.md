# wa-app-electron

WA App 的 Electron + React + Vite + TypeScript 全平台桌面客户端。

## 当前能力

- 默认连接远程服务 `https://wa.yizhimeng.uk`，访问密码只通过本机设置或运行时环境变量提供，不写入源码、README 或提交历史。
- Electron 主进程提供 preload 安全桥，renderer 只通过 `window.waConfig`、`window.waApi`、`window.waService` 调用桌面能力和 `/api/wa/...`。
- 支持账号列表、账号删除、长连接状态、client profile/设备指纹、注册探测、注册 OTP、账号迁移挑战刷新/轮询、登录状态检查、失败注册清理、联系人、消息、发送文本消息、标记已读、删除消息、联系人删除、联系人自动解析、资料名称、头像上传裁剪、头像移除、2FA PIN、邮箱设置、邮箱 OTP 和远程连接配置。
- 内置本地 `wa-app-service` 模式：Windows 后端二进制放在 `resources/wa-app-service/win-x64/` 和 `resources/wa-app-service/win-ia32/`，客户端会按当前架构启动，数据目录默认为 Electron `userData/wa-app-data`。
- Windows/macOS/Linux 打包配置已在 `electron-builder` 中准备：Windows `nsis/zip`，macOS `dmg/zip`，Linux `AppImage/deb`。

## 开发

```sh
npm install
npm run dev
```

开发模式会启动 Vite dev server，并由 Electron 加载 `http://127.0.0.1:5173`。

## 构建

```sh
npm run lint
npm run test
npm run typecheck
npm run build
npx electron-builder --dir
```

生产构建使用相对资源路径，打包后的 `file://` 页面不依赖 Vite dev server。

## 迁移对账

已从 `wa-app` dashboard 迁移到桌面端：

- 账号管理：账号列表、分页、搜索、删除、账号详情、长连接状态、client profile 和设备指纹。
- 注册链路：号码探测、通道选择、注册请求、OTP 提交、账号迁移挑战刷新/轮询、登录态持久化入口、失败待注册账号清理。
- 联系人与消息：联系人列表、联系人自动解析、聊天线程、发送文本、标记已读、删除本地消息、删除联系人和 OTP 历史。
- 账号设置：资料名、头像上传裁剪、头像移除、2FA PIN、邮箱设置、邮箱 OTP 请求/校验、手动登录状态检查。

桌面端新增能力：

- 本地/远程服务模式切换、本地 `wa-app-service` 启停、密码本机加密保存。
- SMSBower/Hero-SMS 接码平台注册、OpenAI 手机号占用检查、接码订单取消队列。
- 打包后 `file://` smoke、mock UI smoke 和远程 API smoke。

已知暂不迁移：

- 换绑手机号/Change Number：原 dashboard 组件也标注后端链路未接入，本轮不实现。
- 原 webui 的 shadcn/router 文件结构：桌面端保留现有 Electron + HashRouter 架构，只迁移能力和行为。

## 远程验收

远程 smoke 只读访问线上服务，不会把密码写入仓库。PowerShell 示例：

```powershell
$env:WA_APP_ELECTRON_SMOKE_PASSWORD = "<访问密码>"
npm run smoke:remote-api
Remove-Item Env:\WA_APP_ELECTRON_SMOKE_PASSWORD -ErrorAction SilentlyContinue
```

当前脚本会验证：

- `/api/wa/health`；桌面连接测试也支持在该路径不可用时回退到 `/healthz`
- `/api/wa/accounts`
- `/api/wa/long-connections`
- 如果线上存在账号，会继续验证 client profiles、OTP 历史、联系人、消息列表。

如果线上账号数为 0，账号内深层检查会显示为 `skipped`，这是当前数据状态导致的跳过，不代表这些入口未实现。

## 桌面烟测

先生成 unpacked 包：

```powershell
npm run build
npx electron-builder --dir
```

再运行桌面 smoke：

```powershell
$env:WA_APP_ELECTRON_SMOKE_PASSWORD = "<访问密码>"
npm run smoke:electron
npm run smoke:mock-ui
Remove-Item Env:\WA_APP_ELECTRON_SMOKE_PASSWORD -ErrorAction SilentlyContinue
```

桌面 smoke 会使用临时 `userData` 目录，并验证：

- 打包后的页面通过 `file://` 加载。
- React renderer 已真实挂载 `.app-shell`、`.account-rail`、`.workspace`，避免生产白屏回归。
- preload 安全桥 `window.waConfig`、`window.waApi`、`window.waService` 存在。
- 远程配置为 `remote`，地址为 `https://wa.yizhimeng.uk`。
- 密码只在本机配置中保存为加密字段，不出现明文。
- renderer 内部调用 `window.waConfig.testConnection()` 能通过远程健康检查。
- DevTools 没有在生产窗口中打开。

`npm run smoke:mock-ui` 会启动一个本地 mock `/api/wa/...` 服务，并用打包后的 Electron 连接它，验证有账号数据时账号栏、联系人列表、聊天线程、账号详情、OTP、长连接和设置页都能渲染；同时会实际触发发送消息、注册探测、发起注册、提交注册 OTP、账号迁移挑战刷新/轮询、登录状态检查、失败注册清理、修改资料名称、2FA PIN、邮箱设置和邮箱 OTP 请求/校验等按钮链路。这个测试不依赖线上账号数量。

完整本地验收顺序：

```powershell
npm run lint
npm run test
npm run typecheck
npm run build
npx electron-builder --dir
npm run smoke:mock-ui
```

远程 smoke 需要额外设置 `WA_APP_ELECTRON_SMOKE_PASSWORD`，否则只运行本地 mock smoke。

## 打包

```sh
npm run dist
```

当前 Windows 环境已验证 `npx electron-builder --dir` 可以生成 `release/win-unpacked/WA App.exe` 并启动。完整安装包、macOS、Linux 产物需要在对应平台或 CI 环境继续跑 `npm run dist` 验证。
