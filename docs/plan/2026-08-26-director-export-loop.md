# 导演一条龙：配乐 → 剪辑 → 导出

状态：✅ 已交付

日期：2026-08-26

## 为什么现在做

分镜、静帧、H3 已在导演循环里。成片却停在「请去预览区点导出 MP4」。MiniMax Design 的差距是 Agent 拆镜、生成、配乐、剪辑、导出一条龙。本步把后半段收进导演 MCP。

## 范围

- 新 MCP `nomi_export_timeline`：项目必须在前台打开；走现有 ffmpeg 时间轴导出；画布落下「剪辑成片」卡。
- 导演 skill STEP 7：镜头通过后配乐关口（本机导入或跳过）→ `nomi_assemble_timeline` → `nomi_export_timeline`。
- 不接音乐生成模型。不把导出做成 AI 剪辑（仍是硬切）。

## 不动项

- 视频只许 AutoDL.art H3，静帧只许 Codex imagegen。
- 不伪造 I2VA / 参考视频，不接 Dreamina，不走 playbook 平行线。
- 不接 xfade / 技能选择器。

## 验收

1. 时间轴有画面时，导演可 `nomi_export_timeline` 得到 MP4 + 成片卡，不必去预览区手点。
2. 时间轴无画面 → 明确报错，提示先 assemble。
3. 项目未打开 → 409。
4. BGM 仍只导入本机音频或跳过。
