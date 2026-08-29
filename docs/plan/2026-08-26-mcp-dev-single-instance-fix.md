# 开发版 MCP 冷启动单实例修复

状态：✅ 已交付

日期：2026-08-26

## 根因

开发版 Nomi 通过 `NOMI_ELECTRON_USER_DATA_DIR` 隔离 Electron profile，并在该 profile 上获取单实例锁。当前一键写入的 MCP 配置只记录 Electron 可执行文件与仓库入口；桥接器找不到实例广告时冷启动 GUI，却没有恢复同一个 `userData`。第二个 GUI 因而在默认 profile 上成功取得另一把锁，同时继承同一项目库路径，形成两个写者。

## 范围

- 开发版 MCP 配置记录当前 Nomi 的 `userData`、设置根、项目根与开发 renderer 地址。
- 冷启动继续走现有 `mcpNodeLauncher`，不新增第二套启动器。
- 增加配置契约测试：开发条目必须保持同一 profile/库/renderer；打包条目不得携带开发环境。
- 增加真实进程回归：两个冷启动请求共享同一 profile 时只允许一个 GUI 写者。

## 不动项

- 不修改打包版 `/Applications/Nomi.app` 的 Helper 启动方式。
- 不修改 MCP 鉴权、项目库指纹、付费确认或工具协议。
- 不修改模型、画布、导演与用户界面。
- 不触碰当前工作区 `main` 上未提交的导演功能改动。

## 回滚

单 commit 回滚本计划、`mcpConfig` 与对应测试即可；现有客户端配置仍可由 Nomi 的“升级接入”重新生成。

## 验收门

1. `mcpConfig` 单测证明开发配置包含同一绝对 `userData`、项目根、设置根和 renderer URL。
2. 打包配置不出现上述开发专用变量。
3. `mcpNodeLauncher` 冷启动并发测试保持单实例。
4. 类型检查、lint、完整 Vitest、build 与项目 push 前门禁通过。
5. 真机：关闭多余实例后重新升级 Codex 接入；触发 MCP 握手不再出现第二个 Nomi 主进程，原项目仍可读。

## 验证结果

- MCP 定向回归：2 个测试文件、21 项通过。
- 完整 Vitest：752 个测试文件通过、1 个跳过；6677 项通过、1 项跳过。
- 静态门禁、lint（97 条既有 warning，低于 98 棘轮）、应用/Electron 类型检查、测试类型棘轮与生产构建全部通过。
- 首轮完整测试因当前 Codex shell 的 PATH 缺少裸 `node`/`npx` 出现 15 项环境失败；补入仓库锁定 Node 与仅代理本地 `tsc` 的临时 `npx` 后全绿，未修改产品代码或基线。

## 官方依据

- Electron `app.setPath('userData', path)` 覆盖 profile 路径；目录需预先存在。
- `app.requestSingleInstanceLock()` 只保证共享同一应用实例身份的进程互斥。Nomi 在取锁前按 `NOMI_ELECTRON_USER_DATA_DIR` 设置 `userData`，因此冷启动必须恢复同一个值。
