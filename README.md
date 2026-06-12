# wa-app-electron

WA App 的 Electron + React 全平台客户端。

## 当前阶段

- Electron 主进程、preload 安全桥、React renderer、Vite、TypeScript 已搭建。
- 默认支持连接远程服务，连接地址默认是 `https://wa.yizhimeng.uk`。
- 访问密码通过客户端设置页输入并保存到本机配置，不写入源码或提交历史。
- 已预留本地内置 `wa-app-service` 模式：后续把各平台二进制放入 `resources/wa-app-service/` 后可由客户端启动。
- 桌面 UI 已覆盖网页端 dashboard 的主要操作入口：账号、注册/OTP、联系人、消息、资料、安全、设备指纹、长连接和设置。

## 开发

```sh
npm install
npm run dev
```

## 验证

```sh
npm run typecheck
npm run build
npx electron-builder --dir
```

## 打包

```sh
npm run dist
```
