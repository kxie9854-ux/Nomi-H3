# 下一阶段：导演主路径产品化

状态：✅ 已交付

日期：2026-08-25

## 为什么现在做

P1 两镜成片闭环已经真机跑通。新开空项目时，画布仍在教用户手建 image 节点，Codex 默认收起，顶栏还有「Nomi 助手」切换。产品还不像「说一句话就能导演成片」。

## 范围

- PR0：快照当前已验证 fork（本文件之前的工作区）。
- PR1：空画布 CTA 改为打开 Codex；空项目默认展开导演面板。
- PR2：Codex 顶栏去掉「Nomi 助手」主按钮，改到溢出菜单。
- PR3：`nomi_import_asset` 收音频；assemble 把 audio 节点排到音频轨。
- PR4：时间轴导出成功后，画布落一张 `kind=clip` 成片卡。

## 不动项

- 视频只许 AutoDL.art H3，静帧只许 Codex imagegen。
- 不伪造 I2VA / 参考视频，不接 Dreamina，不走 playbook 平行线。
- 不接音乐生成模型；BGM 只导入本机音频。
- 不删 `CanvasAssistantPanel` 实现。

## 回滚

各 PR 独立可逆。空态/顶栏/音频白名单/导出后 addNode 均可单独撤回。

## 验收门

1. 新建空项目：Codex 展开，空画布主按钮是「开始导演」，不落空 image 节点。
2. Codex 顶栏无「Nomi 助手」主按钮；溢出菜单仍可切回。
3. 导入本机 mp3 后 assemble，音频轨有 clip。
4. 时间轴导出成功后画布出现成片卡，重启仍在。
5. 不回归已有两镜 hydration、分组、resume_only、花费确认、竖屏画幅。

## 落地备注（2026-08-25）

- 成片卡复用现有 clip→canvas 导出形态：`kind=video` + `meta.outputKind=timeline-export`，标题走「剪辑成片」。`kind=clip` 仍是剪辑编辑器，不是成品预览卡。
- BGM 不生成：`nomi_import_asset` 扩音频白名单，`nomi_add_nodes.assetUrl` 只接受 `nomi-local://`。
- 单测已覆盖空画布打开导演、音频 import/assemble 规划、成片节点幂等、导演阶段条。
- 未在本轮做完整 Electron 真机走查（需 `pnpm dev` 后新建空项目点「开始导演」、导入 mp3、导出成片）。
