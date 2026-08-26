// Codex 本地文本大脑。无 mapping：agent / 提示词优化走 buildLanguageModelForVendor
// → CodexChatLanguageModel → 本机已登录的 `codex exec`，不走 OpenAI Platform API。
export const CODEX_CHAT_MODEL_KEY = "codex-chat";
export const CODEX_CHAT_MODEL_LABEL = "Codex 对话（登录额度）";

export const CODEX_CHAT_CURATED_MODELS = [
  {
    modelKey: CODEX_CHAT_MODEL_KEY,
    labelZh: CODEX_CHAT_MODEL_LABEL,
    kind: "text" as const,
    meta: { supportsImageInput: true },
  },
];
