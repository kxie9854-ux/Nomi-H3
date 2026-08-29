# Nomi-H3 交接（给 Codex 继续开发）

日期：2026-08-25  
仓库：`/Users/kaijun/Documents/ChatGPT/Nomi-H3`  
基线：Nomi `v0.20.1` 的个人 AGPL fork。上游 remote 叫 `upstream`。  
详细产品事实也写在 `FORK.md`。本文是当前状态 + 怎么跑 + 下一步，不是上游 Nomi 的通用纪律。

**先读这份再改代码。** 不要读 `AGENTS.md` 里的「主仓库 `/Users/aoqimin/Desktop/Nomi`」或每日论文雷达——那是上游工作流，会把这次开发带跑。导演侧栏里的 Codex 也必须忽略 `AGENTS.md` / `CLAUDE.md` / `docs/research`。

## 0. 2026-08-24 最新完成

### 2026-08-29 增量

- **导演 Codex 模型/力度**：侧栏可点选 `turn/start` 的 model + effort（「默认」省略键，继承 ~/.codex/config.toml）；`model/list` 失败时面板仍可用。
- **AutoDL.art 视频无响应**：create 缺 data.task_id 或 code!==Success 时直接报错，不再用本地 task-uuid 空转轮询；缺尾帧的 I2VA 在扣费前拒发。

### 2026-08-27 增量（bug 修复两笔）

- **中文名 skill 导入修复**：`importDirectorSkillMarkdown` 此前只取 frontmatter 名或文件名**一个**候选去清洗 id，frontmatter 写中文名（如 `name: 夜市`）时洗不出 ASCII id 直接报「技能名不合法」，即使文件名合法。现在逐候选回退（frontmatter → 文件名 → 内容哈希 `skill-<hash8>` 兜底），同内容重导同 id 幂等覆盖。
- **围栏 tool-call 解析修复**（`codexChatPrompt.ts`）：① `arguments` 被模型写成 JSON 字符串（常见输出）时不再静默丢成 `{}`；② 剥离与解析改用同一判据——没变成 tool-call 的围栏（坏 JSON / 未声明工具名）留在正文里可见，不再被静默吞掉；③ 纯聊天（未声明工具）时模型冒出的围栏不再变成对不存在工具的 tool-call（AI SDK 会拒），空集判据统一。
- ~~遗留待查~~ **collectAgentText 已修（快照按 id）**：`item.text` 视为该 item 的快照而非增量；按 `item.id` 分组（无 id 则每条独立），同 id 优先 `item.completed`，否则取最后一次 `item.updated`/无 type，按首次出现顺序把不同 agent_message 用换行拼接。

### 2026-08-26 增量（四计划收尾：文本大脑 / Skill 点选 / 多镜定妆 / 首配引导）

- **Codex 文本大脑**：catalog 种出 `codex-chat`（kind=text、无 mapping、authType=none），`vendorLanguageModel` 对它走 `electron/ai/codexChatLanguageModel.ts`——`codex exec --json --ephemeral` 封装成 AI SDK LanguageModelV1，tool schema 用 `<<<NOMI_TOOL` 围栏进 prompt、回包解析成 tool-call；不开 `--enable image_generation`。助手下拉出现「Codex 对话（登录额度）」，接入卡文案改「对话 + 出图」。隔离真机走查 `tests/ux/codex-chat-brain.walk.mjs` 9/9 过（含 catalog 落盘断言），截图 `tests/ux/shots/codex-chat-card.png` / `codex-chat-picker.png`。
- **导演 Skill 点选**：侧栏 `DirectorSkillPicker` 芯片，三档「无技能 / 成片 / 创建技能」，成片脊柱 + 最多 3 个 overlay（古装/运镜/表演/声音/动作/美术/场面/一致性/转场/风格共 10 个），可导入本机 `SKILL.md`（≤256KB，落 `userData/codex-director/imported-skills/`）；`turn/start` 把脊柱+overlay 作为 skill 输入（host.test 已钉 overlay 附在脊柱后）。IPC `nomi:codex:list-skills` / `import-skill`；author 模式配套 `skills/director-skill-author/`。走查 `tests/ux/director-skill-picker.walk.mjs` 全过（三档切换/古装点选/listSkills 11 条/导入自动选中）。
- **多镜身份锁**：MCP `nomi_freeze_nodes`（只冻已出图的角色/场景/道具卡，幂等）；skill STEP 6 lock-look 关口——定妆图出图→用户锁定→freeze→`character_ref`/`composition_ref` 连各镜首尾静帧→静帧生成自动吃到定妆图走 Codex `image_edit`，冻结前不出镜头静帧；core 对未冻结引用只提醒不拦（`advisories`）。机制链已由 `core.test.ts` 集成测试钉死（出图落卡→冻结→连边→不传 references 的静帧生成走 image_edit 且 referenceImages=定妆图）。真机多镜会话（导演真实跑 lock-look 全流程）待下个项目实测。
- **首配引导**：`directorBackendReady` 从 catalog 派生静帧/视频后端可用性，缺任一显示 `DirectorSetupBanner`「去配置模型」（既有 `nomi-open-model-catalog` 通道，不另造登录）；不拦发送。隔离空项目走查截图里可见该条（`director-skill-picker.png`）。
- 全门重跑通过并盖 `.claude/.gates-ok`（filesize / tokens / i18n / lint 98 / 双 TS / 全量 Vitest / production build）；两个走查脚本本日复跑 exit 0。

### 2026-08-25 增量

- 导演会话已改为按 `projectId` 隔离并持久化到 `userData/codex-director/project-threads.json`；A/B 切换和完整 Electron 重启均已真机验证，同项目恢复原 Codex thread。
- 真实多镜项目 `project-1787587773096-jv4q8a` 已自动建立 `S01｜发现` / `S02｜追逐` 两组，每组四节点，首尾帧连线正确；四张静帧均成功并完成人眼检查。
- 修复 bundled Codex imagegen 二进制发现与 spawn 错误竞态；修复终态失败任务被永远续查；Context7 可选 MCP 初始化失败不再把原始 Rust JSON 暴露到侧栏，其它 ERROR 仍保留。
- “项目级导演工作台恢复”阶段 2 已完成：打开项目即恢复真实 thread 历史，并显示从画布/时间线派生的制作摘要；项目切换世代保护、host 事件 projectId 路由、历史/live 去重、旧选择只读、加载/失败降级均已落地。真机《晨光逐蝶》恢复为“2 个镜头已成片 · 时间轴 0:10 · 9:16”，截图见 `tests/ux/shots/director-history-restored.png`。计划与完整验证见 `docs/plan/2026-08-25-director-workspace-hydration.md`。
- 真机走查顺带抓到并根因修复项目画幅未持久化：`previewAspectRatio` 现在写入项目 payload，切换会触发 autosave，旧项目兼容回落；真实竖屏项目已通过 UI 写回 9:16。
- 导演编号选项兜底已完成：明确提问后的末尾连续 2–5 项 `1. / 2.`、`1、/ 2、`、`(1) / (2)` 会复用现有选项按钮；分镜/步骤清单、断号、非末尾与超长列表保持文本，正式 `:::choices` 始终优先。计划见 `docs/plan/2026-08-25-director-numbered-choice-fallback.md`。
- 真机走查启动器的关闭兜底已修根因：`app.close()` 超时后会只终止本次启动的 Electron child；真实预览页修复走查已从挂起改为正常 `exit 0`。
- 当前两镜短片已完成：S01 `2bc7b3ad-fed4-484d-a59e-980b3b0f580e`、S02 `8639fe7a-1acf-4fc8-9a6b-2a55ea328145` 均由 AutoDL.art MiniMax H3 成功生成并逐帧人眼审片；S01 官方调用日志确认 workflow `minimax_h3_lightx2v`、费用 ¥0.10。旧的终态任务 `task-cc254ce3-fef8-4368-8120-cb8155e5af4d` 不再续查。
- 两段视频已按 S01 → S02 排入 9:16 时间轴并导出 10.33 秒成片：`.tmp/electron-user-data/dev-5273/projects/未命名项目 08_25 00_09-mt7fltbj-e8df0259/exports/nomi-export-202608252027.mp4`（1080×1920、H.264/AAC）。导出首/中/尾帧均已人眼检查，无实际白边。
- 根因修复生成画布视频卡误报超时：8 秒并发槽看门狗不再销毁健康媒体；更底层的 React 18 StrictMode effect cleanup 清空已挂载 `<video src>` 也已改成 callback ref 真卸载释放。真机 DevTools 曾钉到 `currentSrc=""` / `readyState=0` / `networkState=0`；干净重启后两张卡均显示首帧和独立视频控件，跨过 30 秒仍稳定无超时。计划见 `docs/plan/2026-08-25-deferred-video-timeout.md`。
- 当前全门：filesize / tokens 0/0/0/0 / i18n 零硬编码 / lint（98 warnings，阈值 98）/ 双 TypeScript / 全量 Vitest（680 files passed、1 skipped；6069 tests passed、1 skipped）/ pnpm 10.8.1 production renderer + Electron build / 真机体验走查全绿。

- H3 断线任务现在会在拿到 `taskId` 时立即持久化；轮询断网进入可恢复态，`resume_only` 只续查原任务，不重新下单。本次小猪任务已原单续查成功。
- 当前测试项目 `project-1787501041770-jivtcp` 已把成功视频排入时间轴并导出 9:16 MP4；时间轴只有 1 条视频，无误插图片或重复 clip。
- MCP 工具从 23 个增至 24 个，新增 `nomi_group_nodes`。它按现有 group schema 建组、跳过缺失/跨类别节点、同步 `node.groupId`，重复调用幂等复用；`nomi_read_canvas` 会返回精简 groups。
- 导演 skill 已在落完 shot / 首帧 / 尾帧 / video 后立即建镜头组，并在已有 taskId 时优先 `resume_only`。
- 根因修复还包括：活动项目总是同步到能力核；重复媒体 clip 自动换唯一 ID，旧重复数据在 normalize 时自愈。
- 全量 Vitest 6015 条通过；filesize、tokens、i18n、lint、双 TypeScript、production build 全绿。详细范围与验证见 `docs/plan/2026-08-24-h3-recovery-and-canvas-group-mcp.md`。

---

## 1. 产品目标

本地部署的 MiniMax Design / LibTV：用户说一句想法 → 右侧 Codex 导演一步步确认 → 画布落简报/静帧/视频 → 时间轴成片。

不是改造 DFCine，不是用 Platform API 计费。导演是 ChatGPT 桌面版内嵌的 Codex app-server（套餐额度）。视频走 AutoDL.art 上的 MiniMax H3 ComfyUI HTTP。

---

## 2. 硬约束（违反即错）

- 不要解包 DFCine 的 asar，不要用 DFCine 画布。
- 不要把 AutoDL.art token、ChatGPT 登录态写进 git。Token 只贴在 Nomi → 模型接入 → AutoDL.art。
- AutoDL.art **没有** 只给首帧的 I2VA，**没有** 参考视频槽。不要假装有。缺尾帧就请用户补，或改 ref2va（多图 ± 音频）。
- 视频只许 `vendor=autodl-art` `modelKey=autodl-art-h3`。分辨率枚举是中文：`480p竖` / `768p竖` / `480p横` / `768p横`。便宜默认 `duration=5` + `480p竖`。
- 静帧只许 `vendor=codex-local` `modelKey=codex-imagegen`。Codex 生图没有比例参数，把 9:16 / 16:9 写进 prompt。禁止 dreamina / ComfyUI 生静帧。
- 这是个人 fork，不要按上游「独立任务分支 + PR 交 main」那套去改别人的 Nomi。
- 改 Electron 主进程后必须重新 `pnpm dev`。只靠 Vite HMR 换不了 `dist-electron/`。

---

## 3. 怎么跑

本机 Node 用 TRAE 那份，否则 pnpm 可能找不到：

```bash
NODE_BIN="/Users/kaijun/Library/Application Support/TRAE SOLO CN/ModularData/ai-agent/vm/tools/opt/node/26.3.1/bin"
export PATH="$NODE_BIN:$PATH"
cd /Users/kaijun/Documents/ChatGPT/Nomi-H3
npm exec --yes pnpm@10.8.1 -- dev
```

- Vite 默认 `http://127.0.0.1:5273/`
- 开发 userData：`.tmp/electron-user-data/dev-5273/`
- 项目库：上述目录下的 `projects/`
- 能力核 RPC：启动日志里的 `127.0.0.1:<port>`
- 改 `electron/` 后重启整个 `pnpm dev`（脚本会 `tsc -p electron/tsconfig.json`）
- 针对本 fork 的单测示例：

```bash
npx vitest run \
  electron/codexAppServer/host.test.ts \
  electron/capabilityCore/timelineAssemble.dispatch.test.ts \
  electron/capabilityCore/plainTextDoc.test.ts \
  electron/capabilityCore/canvasGraph.test.ts \
  src/workbench/generationCanvas/agent/directorChoices.test.ts \
  src/workbench/generationCanvas/agent/directorStage.test.ts \
  src/workbench/generationCanvas/agent/directorActivity.test.ts \
  src/workbench/generationCanvas/agent/directorTurnContext.test.ts
```

导演 skill 改完要同步三份（仓库是真相源，后两份给 CLI / 本机 agent）：

- `skills/h3-autodl-art-director/`
- `~/.codex/skills/h3-autodl-art-director/`
- `~/.agents/skills/h3-autodl-art-director/`

内嵌 Codex 的 cwd 是 userData 下的 `codex-director/`（有一份我们写的短 `AGENTS.md`），**不是** 仓库根。这样导演不会去跑论文雷达。

---

## 4. 架构（本 fork 加的层）

```
生成画布右侧 Codex 面板
  → Electron Codex app-server（stdio NDJSON，不是 unix://）
  → 每轮加载 skill h3-autodl-art-director
  → Nomi MCP（能力核）
  → 渲染层网关（项目正在前台）或磁盘网关
  → 画布 store / 时间轴 store
```

| 职责 | 路径 |
|---|---|
| AutoDL.art H3 目录 | `catalog/autodl-art-h3.json`，`electron/catalog/autodlArtH3.ts`，`src/config/modelArchetypes/minimaxH3AutodlArt.ts` |
| H3 模式（t2va/fl2va/ref2va） | `electron/catalog/autodlArtH3Mode.ts`；首尾帧从画布边填槽：`electron/capabilityCore/core.ts` 的 `frameUrlsFromEdges` |
| MCP 工具表 | `electron/capabilityCore/mcpToolCatalog.ts` |
| MCP 路由 | `electron/capabilityCore/dispatcher.ts` |
| 主进程 ↔ 渲染层 | `electron/capabilityCore/gateway.ts`，`rendererBridge.ts`，`src/workbench/capability/capabilityApplyHandler.ts` |
| 内嵌 Codex | `electron/codexAppServer/host.ts`，`ipc.ts`，`ndjsonRpc.ts`，`resolveCodexBin.ts`（二进制在 `/Applications/ChatGPT.app/Contents/Resources/codex`） |
| 导演侧栏 | `src/workbench/generationCanvas/components/CodexDirectorPanel.tsx` |
| 选项卡 / 阶段条 | `src/workbench/generationCanvas/agent/directorChoices.ts`，`directorStage.ts`，`directorActivity.ts` |
| 画布上下文（钉死 projectId） | `src/workbench/generationCanvas/agent/directorTurnContext.ts`，`electron/codexAppServer/directorUserText.ts` |
| 导演历史只读恢复 | `electron/codexAppServer/directorHistory.ts` → `host.readDirectorHistory` → IPC/preload/desktop bridge → `CodexDirectorPanel.tsx`；合并与摘要在 `agent/directorHistoryHydration.ts`、`agent/directorRestoreSummary.ts` |
| 成片排时间轴 | MCP `nomi_assemble_timeline` → `timeline.assemble` → `arrangeStoryboardToTimeline()` |
| 成片导出 MP4 | MCP `nomi_export_timeline` → `timeline.export` → `exportTimelineToMp4()` + 剪辑成片卡 |
| 文本卡正文 | MCP 把 brief 写在 `prompt`；`plainTextToTiptapDoc` 灌进 `contentJson`。卡 UI：`TextDocumentNode.tsx` |
| 官方 H3 提示词 | `skills/h3-prompt-writing/`（T2VA/FL2VA = `references/base-en.txt`，Ref2VA = `references/ref-en.txt`） |
| 导演 skill | `skills/h3-autodl-art-director/SKILL.md` |
| 导演模板点选 | 侧栏芯片 → `nomi:codex:list-skills` / `import-skill` → `turn/start` 附加 overlay skill |
| Codex 文本大脑 | catalog `codex-chat` 种子（`electron/catalog/codexChat.ts`）→ `vendorLanguageModel` → `electron/ai/codexChatLanguageModel.ts`（`codex exec --json --ephemeral` → LanguageModelV1） |

H3 实际有的模式：

| 用户说法 | 模式 | 怎么发 |
|---|---|---|
| 文生视频 | t2va | `intent=video`，不带图 |
| 图生视频（只首帧） | **没有** | 要尾帧走 fl2va，或改 ref2va |
| 首尾帧 | fl2va | `first_frame` + `last_frame`，同画幅 |
| 参考图 | ref2va | `references` 1–9 张 |
| 参考图+音频 | ref2va | `references` + `audio_references`（≤3，各 2–15s） |
| 参考视频文件 | **没有** | 直接说没有槽 |

付费生成仍走 Nomi spend gate。内嵌 Codex 路径上 elicitation 目前会自动 `{ action: "accept", content: { confirm: true } }`（见 `nomiElicitationAccept`）。这是为了不卡死，**不是** 产品上的最终付费 UX。

---

## 5. 已经做成的

- 丢掉 DFCine，Nomi 画布 + AutoDL.art H3。
- 四种能打的模式都在 480p 竖屏 5 秒上跑通过（文生、首尾帧、参考图、参考图+音频）。
- 生成区默认导演是 Codex，不是 Nomi 内置助手。
- 握手：`initialize` 每进程一次；`Already initialized` 当成功。MCP 环境带上活的 `NOMI_PROJECTS_DIR` / `NOMI_SETTINGS_DIR`，否则会读错 `instance.json`。
- 审批策略 `on-request` + 自动接受本会话 MCP 写；Nomi 花费 elicitation 必须 `content.confirm === true`。
- 新镜头默认静帧优先：shot + 首尾图 + video，先出 Codex 静帧，用户确认后再 H3。
- 导演 skill 是通用成片脊柱（从 MiniMax 3D 动画 skill 抽流程，**没有** 搬皮克斯造型和七列口型表）：关口 → 简报 →（多镜才大纲/角色/场景/镜头表）→ 静帧 → H3 → 配乐（导入或跳过）→ `nomi_assemble_timeline` → `nomi_export_timeline`。
- 侧栏：阶段条（简报/静帧/确认/出视频/成片）；MCP 原文不当聊天刷；`:::choices` 渲染成可点按钮；技能三档「无技能 / 成片 / 创建技能」。成片档可叠古装/运镜等（最多 3 个）或导入 `SKILL.md`。创建技能走 `nomi_save_director_skill`。
- 成片：`nomi_assemble_timeline` 按镜序把视频追加到时间轴（项目必须在前台打开，否则 409），然后 `nomi_export_timeline` 走 ffmpeg 硬切导出 MP4 并落下剪辑成片卡。不是 AI 剪辑，没有 xfade。

---

## 6. 刚修过的坑（2026-08-23）

项目 `project-1787449763984-a0idbg`（磁盘名「未命名项目 08/23 09:49」）测「小猪跳舞」时：

1. **空白文本框**：MCP 把简报写在 `prompt`，文本卡只渲染 `contentJson`。现已在 `canvasGraph.addNodes` 和 `TextDocumentNode` 从 prompt 灌正文。
2. **误报「源节点不存在」**：MCP 落节点后立刻 `FOCUS_GENERATION_NODE_EVENT`，当时 React ref 还是旧列表。现已改读 `useGenerationCanvasStore.getState().nodes`。
3. **静帧没落上**：导演猜 node id 去 `nomi_connect_nodes`，端点不存在就静默跳过。skill 现要求：先 `nomi_read_canvas`，一次 `nomi_add_nodes` 建 shot+首帧+尾帧+video，**只用返回的 id 连线**。

重启 Electron 后导演线程会重建，新的 `DIRECTOR_INSTRUCTIONS` 才会生效。

---

## 7. 开发 userData 与测试项目

根：`/Users/kaijun/Documents/ChatGPT/Nomi-H3/.tmp/electron-user-data/dev-5273/`

| 项目 id | 备注 |
|---|---|
| `project-1787449763984-a0idbg` | 2026-08-23 09:49，小猪简报（修文本卡之前几乎是空框） |
| `project-1787377033452-sa2vq4` | 2026-08-22 13:37，晨光花园小猫，有成片 `video-1787411218230.mp4` |
| `project-1787370132539-l9fwv9` | 2026-08-22 11:42，窗边追光小猫 + 早期 canary |

`pnpm dev` 时 Nomi MCP 必须指向这套 projects/settings。不要让 Codex 去 `~/.nomi` 的默认库。

---

## 8. 下一步（按优先级）

**先手测，再加功能。** 打开 `project-1787449763984-a0idbg` 或新建项目，对右侧 Codex 说「一只小猪在跳舞」。应出现选项卡 → 简报有字 → 一次落下 shot/首尾静帧/video → 出静帧后停下。不要在没跑通这条时继续堆流程。

P1（产品还不像 Design）：

1. ~~**付费确认回到面板**~~：已真机验证取消/确认/同服务会话信任边界。
2. ~~**画布分组 MCP**~~：已在真实两镜项目验证自动分组和首尾帧连线。
3. ~~**导演会话按项目持久化**~~：已完成 A/B 隔离和 Electron 重启恢复实测。
4. ~~**完成当前两镜成片闭环**~~：S01/S02 已审片、排入 9:16 时间轴并导出 1080×1920 MP4；画布两张视频卡也已完成 StrictMode 根因修复和真机复验。
5. ~~**项目级导演工作台恢复阶段 2**~~：已实现真实历史 hydration、项目切换竞态/事件隔离、画布派生恢复提示和画幅项目持久化；真实《晨光逐蝶》重启恢复走查与截图通过。
6. ~~**选项卡兜底**~~：严格的末尾编号决策现已复用现有按钮；内容清单与正式协议边界均有测试。

P2（2026-08-25 已真机走通空项目主路径）：

1. ~~**空画布引导**~~：空画布主按钮是「开始导演」，空项目默认展开 Codex。
2. ~~**弱化 Nomi 助手切换**~~：Codex 顶栏改为溢出菜单。
3. ~~**BGM 默认路径**~~：`nomi_import_asset` 收音频；`assetUrl` 绑到 audio 节点；assemble 上音频轨。不接音乐生成模型。
4. ~~**导出后的成片节点**~~：时间轴导出成功后画布落一张 `outputKind=timeline-export` 的 video 成片卡（复用现有 clip 导出落画布的形态，不新发明 kind）。

P3：

1. ~~**第一次打开就能用**~~：`DirectorSetupBanner` 从 catalog 派生静帧/视频可用性，缺后端显示「去配置模型」，走既有模型设置通道；隔离空项目走查截图验证，不拦发送。
2. ~~**导演循环收到导出**~~：`nomi_export_timeline` 在镜头通过后走 ffmpeg 导出并落成片卡；配乐仍只本机导入或跳过。
3. ~~**多镜定妆**~~：`nomi_freeze_nodes` 冻结已出图锚卡，skill lock-look 关口把 `character_ref` / `composition_ref` 连到各镜静帧，静帧生成自动走 Codex 改图（image_edit）带定妆图；机制链集成测试钉死（core.test.ts）。真机多镜会话留待下个项目实测。

不要做：

- 把官方 3D 动画 skill 的皮克斯锁、七列嘴部状态表搬回来
- 接回 Dreamina 生静帧
- 伪造 I2VA / 参考视频
- 走 `nomi_start_playbook` / `nomi_intake_brief` 那条平行制作线（导演 skill 就是制作循环）

---

## 9. 两套 Codex 身份，别混

| 场景 | 身份 | 读什么 |
|---|---|---|
| 生成画布右侧栏 | **导演** | `h3-autodl-art-director` + `DIRECTOR_INSTRUCTIONS`。操作画布，不改仓库。 |
| 在本仓库里写代码 | **工程师** | 本文件 + `FORK.md`。可以改 `electron/`、`src/`、`skills/`。 |

导演 cwd = `codex-director/`。工程师 cwd = 仓库根。改 skill 后两边都要拷。改 `host.ts` 的 `DIRECTOR_INSTRUCTIONS` 必须重启 Electron，否则旧线程还在用旧指令。

---

## 10. 常见翻车

| 现象 | 原因 | 处理 |
|---|---|---|
| `Already initialized` | 面板 `ensure()` 后又 `initialize` | 已当成功；不要再每轮 initialize |
| Codex 去跑论文雷达 | cwd 是仓库根，吃到 `AGENTS.md` | 必须用 `codex-director` cwd |
| MCP `fetch failed` / 冷启动 | 读了默认 `instance.json` | spawn 时注入 `NOMI_PROJECTS_DIR` |
| 画布空白但生成成功 | 写到了最近更新的别的项目 | `wrapDirectorUserText` 钉死当前 `projectId` |
| 付费确认未通过 | elicitation 没带 `confirm: true` | `nomiElicitationAccept` |
| `codex_models_manager timeout` 当 UI 错误 | rust stderr | `isCodexInternalStderr` |
| 静帧出方图 | 比例只写在 prompt 里但走了有 ratio 参数的模型 | 静帧用 Codex imagegen，比例写进 prompt |
| 图生视频缺参考图 | extras 用了 `first_frame` 没成对 `last_frame` | 两槽都发，或改 ref2va |
| 空白文本简报 | 只写了 `prompt` | 已灌 `contentJson`；新节点仍要把简报放进 `prompt` |
| 「源节点不存在」但节点其实在 | 聚焦用了过期 ref | 已改读 store |
| `请在 Nomi 里打开这个项目后再排成片` | 时间轴只活在前台 store | 排成片前确认项目在当前窗口打开 |
| `请在 Nomi 里打开这个项目后再导出成片` | 导出读前台时间轴 | 导出前确认项目在当前窗口打开 |
| 改了主进程代码界面没变 | 只热更新了渲染层 | 重启 `pnpm dev` |

---

## 11. 参考资料

- AutoDL.art ComfyUI API：https://autodl.art/docs/comfyui_api/
- 工作流目录：https://www.autodl.art/large-model/comfyui
- MiniMax 官方 3D 动画 skill（流程参考，不要当造型锁）：本机曾解压在 `/tmp/3d-anim-skill/3d-animation-short-generator/`，zip 在 `/Users/kaijun/Downloads/3d-animation-short-generator.zip`
- 上游工程纪律（仅当改的是 Nomi 原有画布/时间轴行为时查阅）：`AGENTS.md`、`docs/engineering-rules.md`。本 fork 的产品决策以本文为准。
