# 服务端同步记录

后续继续从服务端 `wa-app` 同步客户端功能时，先对比这里记录的服务端提交之后的变更。

## 2026-07-07 核对

- 客户端当前功能补齐提交：`bdd9a127deb92612708d817aecf5fd8b3e96c628`（2026-06-29，`feat(api): 添加待验证账号清理和Play Integrity API支持功能`）。
- 客户端已合入的 `origin/main` 基线：`162ada9ddce3b573d63078b2aece62c75de6a885`（2026-06-18 16:52:50 +0800，`Release v1.0.2`）。
- 上轮对齐参考的本地服务端 `D:\work\github work\wa-app` 提交：`a3ad067b7f72a1f6acef87c617855fbe8adb35dc`（2026-06-29，本地 `main`，`Merge branch 'main' of https://github.com/pood1e/wa-app`）。
- 本轮核对后的本地服务端 `D:\work\github work\wa-app` 提交：`c1ea8a13ef44bb63ce5009573b2573b8e3a3023a`（2026-07-07，本地 `main`，`Merge branch 'main' of https://github.com/pood1e/wa-app`）。
- 刷新时看到的服务端 `origin/main` 提交：`e1cd148d0684bba55f87ad9ed4c0f581424c9f82`（2026-07-05，`Merge: decisive re-layer of internal/app into internal/waapp/*`）。

## 本轮结论

- `a3ad067` 到 `c1ea8a1` 的 dashboard 可见变化主要是注册 BFF/DTO 重构。
- `/api/wa/register` 继续作为桌面客户端入口；服务端内部增加注册状态复用、OTP 等待状态保存、验证码请求 fallback、typed action DTO。
- 服务端新增或稳定化了 `registration/cleanup-failed-account`、`registration/persist-login-state` 等 action 能力，但当前网页端没有直接作为新增 UI 功能使用。
- Electron 已覆盖当前网页端直接使用的 cleanup pending、Play Integrity、probe/register、resume OTP、account-transfer refresh/poll。

## 待处理

- Electron 内置本地服务二进制仍需要用服务端 `c1ea8a1` 重新构建并替换：
  - `resources/wa-app-service/win-x64/wa-app-service.exe`
  - `resources/wa-app-service/win-ia32/wa-app-service.exe`
- 当前本机没有可用的 `go` 或 `docker` 命令；需要使用远程构建机或安装本地构建环境后再更新二进制。
