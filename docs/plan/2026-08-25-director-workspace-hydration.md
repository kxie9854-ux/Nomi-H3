# 项目级 Codex 导演工作台恢复

状态：✅ 已交付

日期：2026-08-25

## 为什么现在做

项目与 Codex thread 的绑定已经能跨 Electron 重启恢复，但导演面板的可见消息仍只活在 React 内存里。用户重启 Nomi 后看到空面板，必须再发一句话才知道旧导演仍在；这会把“本地私人 AI 视频系统”最重要的连续制作感打断。

底层逻辑：Codex thread 已经是对话真相源，画布与时间线已经是制作状态真相源。下一步只做两者的只读投影，不再发明第三份“导演进度”持久化数据。

## 已核实依据

- 本机 `/Applications/ChatGPT.app/Contents/Resources/codex` 生成的官方 app-server schema 支持：
  - `thread/read { threadId, includeTurns: true }`
  - 返回 `ThreadReadResponse { thread }`
  - `thread.turns[].items[]` 中可见对话分别是 `userMessage.content[type=text]` 与 `agentMessage.text`。
- 当前 `CodexDirectorPanel` 的 `lines / busy / activity / elicitation` 都是组件内存。
- 当前制作阶段已经由 `inferDirectorStage(nodes, timelineSourceNodeIds(timeline))` 从画布与时间线派生。
- 项目到 threadId 的映射已落盘，且 A/B 项目隔离、Electron 全重启恢复已通过真实测试。

## 方案取舍

| 方案 | 用户看到什么 | 代价 |
|---|---|---|
| A. thread/read + 画布派生（采用） | 打开项目即看到旧对话；当前制作关卡与画布一致 | 需要协议解析、竞态保护和兼容降级 |
| B. 另存一份面板 messages/stage | 恢复快 | 双真相源，可能与真实 thread/画布漂移，拒绝 |
| C. 保持空面板，等用户再发一句 | 无开发成本 | 用户以为上下文丢失，私人工作台没有连续性，拒绝 |

真正取舍：不是“多存一点更稳”，而是“恢复用户看得见的连续性，同时不复制执行与授权状态”。

## 六角色审查结论

- CTO：thread 与画布各守一个真相源；禁止新增持久化 conversation/stage 文件。
- 设计：恢复是面板内部的情境信息，不新增常驻按钮；复用现有空态、stage strip、`WorkbenchButton` 与 token。
- PM：先解决重启后“不知道做到哪”的真实摩擦，不扩成任务管理器或完整聊天历史产品。
- 前端：请求必须带 projectId 世代/令牌；A 项目请求晚到时不得覆盖已切换到的 B 项目。
- 后端：解析器采用窄白名单；只投影 user/agent 文本，忽略 tool、reasoning、hook、approval、elicitation。
- 真实用户：打开就能接着看；加载失败仍可直接发消息，不能让“恢复失败”堵死创作。

## 范围

### 阶段 1：无 UI 协议层（锁屏期间可执行）

1. 在 Codex app-server host 增加按 projectId 读取已绑定 thread 的只读 history API。
2. `thread/read` 明确传 `includeTurns: true`，解析为稳定的 `user | assistant` 可见行。
3. 去掉 `wrapDirectorUserText` 注入的项目/画布包装，只还原用户原始输入。
4. IPC、preload、desktop bridge 暴露 `readHistory(projectId)`。
5. 加解析、缺失 thread、旧 schema、不支持 includeTurns、错误降级、A/B 隔离测试。

### 阶段 2：面板 hydration（需解锁后先看真机与出样张）

1. 面板打开/项目切换时加载对应历史；加载期间不伪造进度。
2. 用 projectId 请求世代保护，丢弃过时返回。
3. 合并实时事件时按稳定 item id 去重；不重复显示 hydration 与当前 turn。
4. 历史只保留最近的有限可见行，避免大 thread 拖慢面板；后端返回截断标记。
5. 从画布/时间线派生紧凑恢复提示；不持久化 stage。
6. 加 2–3 条真实用户任务 E2E，并按真实界面截图走查。

## 明确不做

- 不持久化或恢复 pending elicitation、spend trust、grant、active turn、busy、activity。
- 不把旧 turn 自动继续执行，不自动重新提交生成任务。
- 不显示 reasoning、工具调用、系统包装、项目 id 或画布上下文注入文本。
- 不新增第二套聊天存储、第二套 stage 状态或并行导演工作流。
- 不在 Mac 锁屏、看不到真实现状时实现/拍板用户可见布局。

## 兼容与失败策略

- 没有已绑定 thread：返回空历史，不创建 thread。
- `thread/read` 不支持/失败/返回未知结构：返回可诊断错误给面板，面板保留现有空态和发送能力。
- 只接受已绑定 projectId；不回退到“最近项目”或 legacy thread。
- 所有未知 ThreadItem 默认忽略；新增协议字段不会直接进入 UI。
- 恢复读取永远是只读，不改变授权、任务或画布。

## 回滚

- 阶段 1 是新增只读桥；可独立回滚，不影响现有 `ensure/send/interrupt/respondElicitation`。
- 阶段 2 若体验不通过，删除 hydration 调用即可退回当前空面板；thread 持久化与生成链路不受影响。

## 验收门

### 单元/集成

- 官方形状：多 turn 的 user/agent 消息按顺序投影。
- 包装剥离：用户只看到原始输入，不看到 projectId/canvasContext。
- 安全排除：tool/reasoning/hook/elicitation/approval 不进入历史。
- A/B：项目 A 历史不出现在 B；A 的迟到响应不能覆盖 B。
- 兼容：无映射、thread 不存在、旧 schema、未知 item、读取失败均可降级。
- 去重/截断：实时消息不重复，超长历史有明确上限与标记。

### 真实用户任务

1. “我重启 Nomi 后打开原项目，想直接看到导演上一轮说了什么，并继续回复。”
2. “我快速从项目 A 切到 B，想确保两个项目的导演历史绝不串台。”
3. “Codex history 读取失败时，我仍想立刻发送新指令继续制作。”

### 完成门

- `check:filesize`、`check:tokens`、`check:i18n`、`lint:ci`、`typecheck`、`test`、`build` 全绿。
- 真机生产入口截图已亲眼检查，光/暗模式与项目快速切换通过。
- 与获批样张逐项对账；真实任务闭环跑通。

## 当前依赖与顺序

《晨光逐蝶》S01/S02 已生成、审片、排入 9:16 时间轴并导出；画布两张视频卡也已完成真机根因修复。阶段 2 已按获批样张实现并通过真实项目恢复走查，不再有待拍板依赖。

## 执行结果

### 阶段 1（2026-08-25）

- 已实现官方 `thread/read { includeTurns: true }` 的窄白名单历史投影、80 行上限与 `truncated` 标记。
- 已把新 turn 的项目/画布包装改成稳定边界标记，并兼容剥离旧包装；修复了旧格式无 canvas 时多段用户文本被误截断的问题。
- 已增加 host 只读 history API、IPC、preload 与 desktop bridge；无绑定项目返回空且不发任何 thread RPC。
- 安全边界已用测试锁死：tool/reasoning/hook/elicitation/approval/授权与运行态均不进入历史。
- 项目 A/B 分别从各自 thread 读取；读取失败不会删除绑定或破坏后续 send/resume。
- 针对性 Vitest：4 files、30 tests 全过。
- `tsc -p tsconfig.app.json` 与 `tsc -p electron/tsconfig.json` 全过。
- 全量 Vitest（非沙盒）：677 files passed、1 skipped；6051 tests passed、1 skipped。
- filesize / tokens / i18n / lint（98 warnings，阈值 98）/ production Tailwind + Vite + Electron build 全绿。
- 单文件均低于 800 行，`git diff --check` 通过。
- 阶段 2 未开始：按 R8 等 Mac 解锁后先检查真实界面、出可体验样张并获批。

### 阶段 2 样张关口（2026-08-25）

- 已在真实《晨光逐蝶》项目打开 496px Codex 导演侧栏，确认重启后现状是：thread 仍绑定，但消息区只显示空态提示。
- 已产出可交互真实布局样张：`docs/design/mockups/2026-08-25-director-history-hydration.html`。
- 样张仅增加一个可见组合：恢复真实 thread 历史 + 从画布/时间轴派生紧凑的“做到哪 / 下一步是什么”；不新增常驻按钮，不恢复旧授权，不自动续跑旧任务。
- 样张已在本地浏览器逐项检查恢复成功 / 恢复中 / 恢复失败，以及光 / 暗两种模式；用户已拍板采用。

### 阶段 2 实现与验收（2026-08-25）

- `CodexDirectorPanel` 会在打开面板与项目切换时只读加载当前项目绑定 thread；projectId + 请求世代双重保护会丢弃迟到响应。
- host 的 delta / item / elicitation / turn-complete / error 事件均携带所属 `projectId`；切换项目后旧 turn 不能再污染新项目面板。
- 历史与乐观实时行按稳定 id 和尾部角色/文本去重；历史选择永远只读，只有当前 live assistant 的最后一组选项可交互。
- 恢复卡只从当前画布、时间线和项目画幅派生，显示阶段、已成片镜头数、时间轴时长、画幅和下一步；不新增进度持久化。
- 加载与失败不会堵住 composer；80 行截断会明确提示，更早内容仍留在 Codex thread 真相源中。
- 真机走查发现并根因修复了既有画幅只活在 Zustand 的缺口：`previewAspectRatio` 现在进入项目 payload，切换画幅会触发 autosave，旧项目兼容回落 16:9。
- 已通过可逆 UI 修复走查把真实《晨光逐蝶》项目写回 `payload.previewAspectRatio = 9:16`；没有手改项目 JSON。
- 真实 Electron 只读走查通过：恢复文案为“2 个镜头已成片 · 时间轴 0:10 · 9:16”，下一步为最终审片与导出；历史旧选择按钮数量为 0。
- 真机截图已亲眼检查：`tests/ux/shots/director-history-restored.png`。
- A/B 迟到响应、host 事件归属、历史去重/稳定 id、派生摘要、画幅 roundtrip 与旧项目 fallback 均有自动化测试。
- 最终门禁：filesize（`workbenchStore.ts` 恰为 800 行）/ tokens 0/0/0/0 / i18n 零硬编码 / lint 98 warnings 棘轮 / 双 TypeScript / Vitest 680 passed + 1 skipped、6063 passed + 1 skipped / pnpm 10.8.1 production build 全绿。
