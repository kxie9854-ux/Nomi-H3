# 多镜身份锁定

状态：✅ 已交付

日期：2026-08-26

## 为什么现在做

一镜路径已走通。多镜时 skill 会建角色/场景卡，但 STEP 6 只连首尾帧到视频，**不定妆图到各镜静帧**。Codex 生图走纯文生，跨镜换脸。

已有机制：`character_ref` 入边会进 `referencesFromEdges`；有参考时 `codex-imagegen` 会改走 `image_edit`（`-i`）。缺的是导演协议把它连上，以及把「锁定」写成 `meta.frozen`。

## 范围

- `nomi_freeze_nodes`：给已出图的 character/scene/prop 写冻结标记。
- 导演 skill + `DIRECTOR_INSTRUCTIONS`：定妆图生成并锁定后，再连到各镜首尾静帧（`character_ref` / 场景用 `composition_ref`），然后才出镜头静帧。
- 一镜路径不变。

## 不动项

- 不接 Dreamina。不伪造 I2VA。不搬皮克斯口型表。
- 不把冻结做成生成硬门（core 仍只提醒不拦）。
