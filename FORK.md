# Nomi-H3 fork

Personal AGPL fork of [Nomi](https://github.com/aqm857886159/Nomi) `v0.20.1`. Upstream remote: `upstream`.

**继续开发先读根目录 `HANDOFF.md`。** 那是给 Codex 的交接（目标、约束、怎么跑、已做/待做、坑）。不要把本仓库当成 `/Users/aoqimin/Desktop/Nomi` 的上游工作树。

## 产品

本地 MiniMax Design / LibTV：一句话想法 → 右侧 Codex 导演逐步确认 → 画布成片。画布和 MCP 仍是 Nomi。不用 DFCine。

## 生成后端

- 视频：AutoDL.art MiniMax H3（`vendor=autodl-art` / `modelKey=autodl-art-h3`）。目录 `catalog/autodl-art-h3.json`。
- 静帧：Codex imagegen（`vendor=codex-local` / `modelKey=codex-imagegen`）。不要用 dreamina。
- 没有 I2VA（只给首帧）。没有参考视频槽。Ref2VA = 图 ± 音频。
- 分辨率枚举：`480p竖` / `768p竖` / `480p横` / `768p横`。便宜默认 5 秒 + `480p竖`。

不要把 AutoDL.art token 提交进 git。贴在 Nomi → 模型接入 → AutoDL.art。

## Codex

- 内嵌：生成区右侧栏默认 Codex。ChatGPT.app 自带二进制，app-server 走 **`stdio://` NDJSON**（不是 `unix://`）。登录用 ChatGPT 套餐，不是 Platform API。
- 导演 skill：`skills/h3-autodl-art-director/`（改完同步 `~/.codex/skills` 和 `~/.agents/skills`）。
- 官方提示词 skill：`skills/h3-prompt-writing/`。
- 导演 cwd：userData `codex-director/`，避免吃到仓库 `AGENTS.md` 去跑论文雷达。
- 成片：MCP `nomi_assemble_timeline`（项目必须在前台打开）。

付费提交仍走 Nomi 花费门。当前内嵌路径会自动带 `confirm: true`（见 `HANDOFF.md` P1）。
