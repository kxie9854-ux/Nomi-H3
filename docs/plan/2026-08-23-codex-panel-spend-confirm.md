# Codex 侧栏付费确认闭环

日期：2026-08-23

## 目标

把内嵌 Codex 导演触发的 Nomi MCP 付费确认放回同一条侧栏对话流，避免全局弹窗抢焦点或在工具调用尚未获批时先失败；同时保证静帧授权不会顺带放行价格更高的 AutoDL.art H3。

## 决策

| 方案 | 用户看到 | 代价 | 结论 |
|---|---|---|---|
| 保留项目级一次授权 | 首次静帧点一次，后续 H3 不再问 | 便宜授权被扩大到昂贵视频 | 不采用 |
| 每次生成都问 | 所有静帧与视频逐次确认 | 打断导演流程，重复劳动 | 不采用 |
| 项目 + 模型服务会话信任 | Codex 静帧首次点一次，AutoDL.art H3 首次再点一次 | 每个模型服务多一次明确确认 | 采用 |

## 范围

- Codex app-server 声明并接收 MCP elicitation 能力。
- Nomi elicitation 不再自动接受；作为待确认事件送到 Codex 侧栏，由用户确认或取消后再答复 app-server。
- 侧栏用现有 token、`InlinePanel` / `WorkbenchButton` 组合呈现紧凑确认，不复制全局弹窗组件。
- MCP 付费会话信任由项目级收窄为项目 + vendor + modelKey；仍保留 20 次安全上限与逐次授权令牌。
- 当前 app-server 构建若已把表单转进侧栏、却未把 `spendConfirmed` 继续带到工具调用，侧栏点击会铸一段
  同项目 + 同模型服务、同样最多 20 次的渲染层桥接票；后续旧确认门逐次消费、不再弹窗。它不能跨到 H3，
  也不能替代主进程逐节点铸造和核销的 spend grant。
- 过滤 Codex Rust 的结构化 JSON 日志，避免内部 WARN 串进用户对话。
- 补齐 IPC、preload、bridge、i18n 与协议/host 单测。

## 不动项

- 不改变直接点击节点生成时的全局 `SpendConfirmDialog`。
- 不改变外部 Claude/Cursor 等 MCP 客户端的 elicitation 路由。
- 不改变 H3 模型、默认 5 秒/480p、首尾帧工作流或节点结构。
- 不持久化授权；重启 app-server 后仍需重新确认。

## 回滚

删除侧栏 elicitation IPC/event，恢复 app-server 对 Nomi 请求的拒绝（不能恢复自动接受）；付费信任键恢复为 projectId。所有改动均为内存态与 UI/协议代码，不迁移项目数据。

## 验收门

1. 单测证明：Nomi elicitation 在用户答复前不返回；确认/取消分别得到 accept/decline。
2. 单测证明：同项目同模型服务免重复确认，切换到 AutoDL.art H3 必须再次确认。
3. 单测证明：结构化 Codex WARN 不进入 UI，真实错误仍显示。
4. 真机：侧栏出现确认卡，全局付费弹窗不出现；确认后静帧成功回写。
5. 真机：进入 H3 提交时侧栏再次明确确认，取消不花额度；确认后才提交。
6. 按项目门禁顺序完成静态检查、类型、测试与构建，并截图人眼对账。

## 验证结果（2026-08-24）

- 真机项目 `project-1787501041770-jivtcp`：Codex 静帧确认只在侧栏出现一次；并发首尾帧与随后单独重试均未再弹全局确认，首尾帧最终都回写原节点。
- 真机切换到 `autodl-art · autodl-art-h3`：侧栏重新出现独立付费确认，证明 Codex 静帧授权未跨模型服务；本轮按“停在确认门”的测试指令未生成 H3 成片。
- 目视截图确认：确认卡与 Codex 对话同栏、图标/标题/按钮语义正确，画布仍可见；内部 Rust JSON 未泄漏。
- 完整门禁依次通过：filesize、tokens、i18n、lint（96/98 warnings）、typecheck、Vitest（670 files passed + 1 skipped；6002 tests passed + 1 skipped）、production build。
