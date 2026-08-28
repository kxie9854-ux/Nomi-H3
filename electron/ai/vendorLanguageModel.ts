// 按 catalog 里的 Vendor/Model 造一个 AI SDK LanguageModelV1。
//
// 单一真相源(P1):对话引擎(agentChatV2)与文本任务引擎(streamTextTask)都从这里取
// 模型构造,不再各写一份「vendor → baseURL/headers → buildAiSdkModel」的拼装。
import type { LanguageModelV1 } from "ai";
import { buildAiSdkModel } from "./buildAiSdkModel";
import { createCodexChatLanguageModel } from "./codexChatLanguageModel";
import { vendorModelConnection } from './vendorModelConnection';
import type { Model, Vendor } from "../catalog/types";

export function buildLanguageModelForVendor(vendor: Vendor, model: Model, apiKey: string): LanguageModelV1 {
  if (vendor.key === "codex-local" && model.kind === "text") {
    return createCodexChatLanguageModel(model.modelAlias || model.modelKey);
  }
  return buildAiSdkModel(vendorModelConnection(vendor, model, apiKey));
}
