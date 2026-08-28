# 项目级导演会话持久化（2026-08-24）

状态：✅ 已交付

## 用户摩擦与根因

- 当前 `CodexAppServerHost` 只有一个进程级 `threadId`：切换项目会继续使用同一线程，导演可能把 A 项目的角色、镜头和批准状态带进 B 项目。
- Electron 重启后内存中的 thread ID 与侧栏消息消失，用户回到同一项目也要重新说明上下文。
- 付费确认 UI 已接入侧栏，但交接文档仍把它列为未开发；先用真实最低档 H3 链路验收，不重复实现。

## 范围

1. 项目 ID 成为导演会话的隔离键；同一项目复用其 Codex thread，不同项目不共用。
2. 将项目到 thread 的映射持久化在开发/正式 settings root；重启 app-server 或 Electron 后优先恢复。
3. 只使用 Codex app-server 官方支持的 thread 读取/恢复能力；不可恢复时清理该项目的失效映射并新建线程。
4. 当前项目 ID 从 renderer → IPC → host 全链路显式传递，不再依赖“最近一次 thread”。
5. 保持已有右侧面板布局、MCP 工具、H3 参数和 spend grant 安全边界不变。

## 不动项

- 不新增平行聊天存储；Codex thread 是对话真相源。
- 不把未完成 elicitation、会话级付费信任或 spend grant 持久化。
- 不自动批准恢复后的生成，不重新提交已有 H3 taskId。
- 不改画布 group schema、时间轴 schema 或模型接入配置。

## 回滚

- 移除项目会话注册表与 projectId 路由，host 恢复单线程 `thread/start`；持久化映射文件可安全忽略。
- 任何失效 thread 映射都允许按项目降级新建，不影响项目画布数据。

## 验收门

1. 单测：A/B 两项目获得不同 thread；切回 A 复用 A thread。
2. 单测：重建 host 后从持久化映射恢复 A；失效 thread 只重建 A，不影响 B。
3. 单测：未提供 projectId 时有明确兼容行为；项目 ID 不得穿越为路径。
4. 安全：恢复会话不会恢复 pending elicitation、spend trust 或 grant。
5. 真机：最低档 H3 未确认/拒绝不提交，确认只提交一次，`resume_only` 不再询费。
6. 真机：2–3 镜项目自动分组；切项目并重启后继续正确项目，最终按镜序入时间轴并导出 MP4。
7. filesize、tokens、i18n、lint、双 TypeScript、全量 test、production build 全绿；逐项目视检查真实 UI 与导出物。

## 2026-08-25 实测结果

- ✅ 项目 A/B 使用不同 Codex thread；切回与完整 Electron 重启后，A 能准确回忆重启前标记，持久化 thread ID 不变。
- ✅ 失效/终态失败的图片任务不会再被当成可续查任务；原角色节点重新提交得到新 taskId，并成功回填。
- ✅ Codex imagegen 可从 ChatGPT bundled Codex 路径启动；spawn ENOENT 不再被后续 close(-2) 覆盖。
- ✅ 真实两镜项目生成 `S01｜发现`、`S02｜追逐` 两个 group，每组恰好包含 shot / first / last / video 四节点；四条 first_frame / last_frame 连线均正确持久化。
- ✅ 付费确认卡显示准确 vendor/model；取消只取消当前请求，确认后同服务会话信任按范围生效。
- ✅ 四张 Codex 静帧均成功并完成人眼连续性检查；S01 H3 创建唯一远端任务 `task-cc254ce3-fef8-4368-8120-cb8155e5af4d`。
- ⏳ AutoDL.art 结果查询仍返回 `queued`；Nomi 已把同一 taskId 收敛为 recoverable，多轮 `resume_only` 未重复下单。需等远端终态后继续 S01 审片 → S02 → 时间轴 → MP4。
- ✅ filesize、tokens、i18n、lint（96/98 warnings）、双 TypeScript、全量 Vitest（6036 passed / 1 skipped）、production build、`git diff --check` 全绿。
