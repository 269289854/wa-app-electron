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

## 2026-07-15 版本同步

- 本轮对比基线：服务端 `c1ea8a13ef44bb63ce5009573b2573b8e3a3023a`。
- 本轮同步目标：本地服务端 `main`，`657b7738cb40e48b52bfdff4bdb0fb020e545731`（2026-07-15，`Merge branch 'main' of https://github.com/pood1e/wa-app`）。
- 本轮服务端 `origin/main`：`28c8c9de612827625a3a505580575c05aa48e4f5`。
- 本轮客户端当前 HEAD：`a728f3fe48d1ccae9105253861b55495161b9c0a`。
- 本轮没有新增 Electron API 或页面入口；服务端变更由内置服务二进制提供：注册协议升级到 `2.26.26.72`、设备画像池更新、注册请求参数形状对齐、消息明文提取和持久化修复。

### 内置服务构建

- 构建环境：本机 Go `1.26.5`，临时 `protoc 31.1`，protobuf 生成插件 `protoc-gen-go v1.36.11`、`protoc-gen-go-grpc v1.6.2`。
- 服务端测试：`go test ./...` 通过。
- 已替换以下文件：
  - `resources/wa-app-service/win-x64/wa-app-service.exe`
  - `resources/wa-app-service/win-ia32/wa-app-service.exe`
- `win-x64` SHA-256：`814E8FF05048F972B6BCBFC9DC9316B6CD141865D66E2CE37859EA3A321BA39F`。
- `win-ia32` SHA-256：`5E34D31FFB4BF257549CA9EFE7133C1E9D1BD8B8CBC3A8942F69E660668A30F4`。
- 本轮远程临时构建容器和临时源码目录已清理，未修改线上 `wa-app` 部署。
