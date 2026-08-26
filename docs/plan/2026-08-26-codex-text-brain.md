# Codex 作为所有文本大脑选项

日期：2026-08-26

## 为什么现在做

Nomi 里凡要选模型的功能，用户希望都能配 Codex（ChatGPT 登录额度，不另接 Platform API）。导演和静帧已经是 Codex；缺口是原生助手 / 引导 / 规划器 / 提示词优化这些 `kind=text` 大脑。

## 范围

- 给 `codex-local` 再种一条 `codex-chat`（`kind=text`，无 mapping，`authType=none`）。
- `buildLanguageModelForVendor` 对这条走 `codex exec --json` 的 LanguageModelV1，而不是 OpenAI 兼容 HTTP。
- 助手下拉、onboarding agent、`streamTextTask` 自动吃到它（同一条 `chooseTextModel` 池）。
- 接入卡文案改成「对话 + 出图」，不是只出图。

## 不动项

- 视频仍只许 `autodl-art` / `autodl-art-h3`。Codex 没有视频模型，不假装有。
- 音频 / TTS / ComfyUI 不加 Codex。
- 不封装 ChatGPT 网页，不读 `auth.json`，不走 Platform API。
- 导演侧栏仍走 app-server，不改成这条 catalog 文本模型。

## 验收

1. 开启「Codex 本地」后，助手模型下拉里出现「Codex 对话（登录额度）」。
2. `applyBuiltinSeeds` 种出 `codex-chat`，且无 create/query mapping。
3. LanguageModel 把 tool schema 写成 `<<<NOMI_TOOL` 围栏，解析后转成 AI SDK `tool-call`。
4. spawn 参数含 `exec --json --ephemeral`，不含 `--enable image_generation`。
