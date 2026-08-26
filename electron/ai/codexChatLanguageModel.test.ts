import { describe, expect, it } from "vitest";
import { generateText, type LanguageModelV1CallOptions } from "ai";
import { buildLanguageModelForVendor } from "./vendorLanguageModel";
import {
  buildCodexChatExecArgs,
  createCodexChatLanguageModel,
  type CodexChatRun,
} from "./codexChatLanguageModel";
import {
  extractCodexAgentMessageFromLine,
  flattenCodexChatPrompt,
  NOMI_TOOL_CLOSE,
  NOMI_TOOL_OPEN,
  parseCodexChatToolCalls,
  stripCodexChatToolFences,
} from "./codexChatPrompt";
import type { Model, Vendor } from "../catalog/types";

const userPrompt = (text: string): LanguageModelV1CallOptions["prompt"] => [
  { role: "user", content: [{ type: "text", text }] },
];

function jsonlMessage(text: string): string {
  return `${JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "agent_message", text } })}\n`;
}

const fakeRun = (text: string): CodexChatRun => async () => ({
  stdout: jsonlMessage(text),
  stderr: "",
  exitCode: 0,
  lastMessage: text,
});

describe("Codex chat prompt", () => {
  it("把 tool schema 写成 NOMI_TOOL 围栏，并保留对话", () => {
    const flattened = flattenCodexChatPrompt({
      inputFormat: "messages",
      mode: {
        type: "regular",
        tools: [
          {
            type: "function",
            name: "read_canvas_state",
            description: "Read canvas",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        ],
      },
      prompt: userPrompt("读画布"),
    });
    expect(flattened.prompt).toContain(NOMI_TOOL_OPEN);
    expect(flattened.prompt).toContain("read_canvas_state");
    expect(flattened.prompt).toContain("[user]\n读画布");
    expect(flattened.prompt).not.toContain("image_generation");
  });

  it("解析围栏 tool-call，并剥掉围栏留下正文", () => {
    const text = [
      "先看一眼画布",
      NOMI_TOOL_OPEN,
      '{"name":"read_canvas_state","arguments":{"q":"x"}}',
      NOMI_TOOL_CLOSE,
    ].join("\n");
    expect(parseCodexChatToolCalls(text)).toEqual([
      { toolName: "read_canvas_state", args: { q: "x" }, argsText: JSON.stringify({ q: "x" }) },
    ]);
    expect(stripCodexChatToolFences(text)).toBe("先看一眼画布");
  });

  it("从 exec --json 的 item.completed 抽出 agent_message", () => {
    expect(extractCodexAgentMessageFromLine(jsonlMessage("OK").trim())).toBe("OK");
    expect(extractCodexAgentMessageFromLine('{"type":"turn.started"}')).toBe("");
  });
});

describe("Codex chat language model", () => {
  it("spawn 参数是 exec --json，不开 image_generation", () => {
    const args = buildCodexChatExecArgs("/tmp/work", "/tmp/last.txt", ["/tmp/a.png"]);
    expect(args).toContain("exec");
    expect(args).toContain("--json");
    expect(args).toContain("--ephemeral");
    expect(args).toContain("-i");
    expect(args).not.toContain("image_generation");
  });

  it("纯文本走 generateText", async () => {
    const model = createCodexChatLanguageModel("codex-chat", fakeRun("你好"));
    const result = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(result.text).toBe("你好");
  });

  it("围栏输出变成 AI SDK tool-call", async () => {
    const fence = `${NOMI_TOOL_OPEN}\n{"name":"read_canvas_state","arguments":{"q":"x"}}\n${NOMI_TOOL_CLOSE}`;
    const model = createCodexChatLanguageModel("codex-chat", fakeRun(fence));
    const { stream } = await model.doStream({
      inputFormat: "messages",
      mode: {
        type: "regular",
        tools: [
          {
            type: "function",
            name: "read_canvas_state",
            description: "Read canvas",
            parameters: { type: "object", properties: { q: { type: "string" } } },
          },
        ],
      },
      prompt: userPrompt("读画布"),
    });
    const parts: Array<{ type: string; toolName?: string; finishReason?: string }> = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
    }
    expect(parts).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "tool-call", toolName: "read_canvas_state" }),
      expect.objectContaining({ type: "finish", finishReason: "tool-calls" }),
    ]));
  });
});

describe("buildLanguageModelForVendor — Codex 文本", () => {
  it("codex-local + kind=text 走 CLI 模型，不走 HTTP", () => {
    const vendor: Vendor = {
      key: "codex-local",
      name: "Codex 本地",
      enabled: true,
      authType: "none",
      baseUrlHint: "local://codex",
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    };
    const model: Model = {
      vendorKey: "codex-local",
      modelKey: "codex-chat",
      labelZh: "Codex 对话（登录额度）",
      kind: "text",
      enabled: true,
      createdAt: "2026-08-26T00:00:00.000Z",
      updatedAt: "2026-08-26T00:00:00.000Z",
    };
    const languageModel = buildLanguageModelForVendor(vendor, model, "");
    expect(languageModel.specificationVersion).toBe("v1");
    expect(languageModel.provider).toBe("codex-local");
    expect(languageModel.modelId).toBe("codex-chat");
  });
});
