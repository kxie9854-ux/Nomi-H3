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

  it("arguments 写成 JSON 字符串也能解析，不再静默丢成 {}", () => {
    const text = `${NOMI_TOOL_OPEN}\n{"name":"read_canvas_state","arguments":"{\\"q\\":\\"x\\"}"}\n${NOMI_TOOL_CLOSE}`;
    expect(parseCodexChatToolCalls(text)).toEqual([
      { toolName: "read_canvas_state", args: { q: "x" }, argsText: JSON.stringify({ q: "x" }) },
    ]);
  });

  it("没变成 tool-call 的围栏留在正文里（损失可见），成功的照剥", () => {
    const allowed = new Set(["read_canvas_state"]);
    const text = [
      "开头",
      `${NOMI_TOOL_OPEN}\nnot json\n${NOMI_TOOL_CLOSE}`,
      `${NOMI_TOOL_OPEN}\n{"name":"undeclared_tool","arguments":{}}\n${NOMI_TOOL_CLOSE}`,
      `${NOMI_TOOL_OPEN}\n{"name":"read_canvas_state","arguments":{"q":"x"}}\n${NOMI_TOOL_CLOSE}`,
      "结尾",
    ].join("\n");
    const stripped = stripCodexChatToolFences(text, allowed);
    expect(stripped).toContain("not json");
    expect(stripped).toContain("undeclared_tool");
    expect(stripped).not.toContain("read_canvas_state");
    expect(parseCodexChatToolCalls(text, allowed)).toHaveLength(1);
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

  it("item.text 是按 id 的快照：updated+completed 不拼接重复草稿", async () => {
    const stdout = [
      '{"type":"item.updated","item":{"id":"item_1","type":"agent_message","text":"Hello"}}',
      '{"type":"item.updated","item":{"id":"item_1","type":"agent_message","text":"Hello world"}}',
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"Hello world"}}',
    ].join("\n");
    const model = createCodexChatLanguageModel("codex-chat", async () => ({
      stdout,
      stderr: "",
      exitCode: 0,
      lastMessage: "ignored",
    }));
    const result = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(result.text).toBe("Hello world");
  });

  it("两个不同 id 的 agent_message 按首次出现顺序用换行拼接", async () => {
    const stdout = [
      '{"type":"item.completed","item":{"id":"item_1","type":"agent_message","text":"First"}}',
      '{"type":"item.completed","item":{"id":"item_2","type":"agent_message","text":"Second"}}',
    ].join("\n");
    const model = createCodexChatLanguageModel("codex-chat", async () => ({
      stdout,
      stderr: "",
      exitCode: 0,
      lastMessage: "ignored",
    }));
    const result = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(result.text).toBe("First\nSecond");
  });

  it("没有 completed 时取该 id 最后一次 updated 快照", async () => {
    const stdout = [
      '{"type":"item.updated","item":{"id":"item_1","type":"agent_message","text":"Hel"}}',
      '{"type":"item.updated","item":{"id":"item_1","type":"agent_message","text":"Hello"}}',
    ].join("\n");
    const model = createCodexChatLanguageModel("codex-chat", async () => ({
      stdout,
      stderr: "",
      exitCode: 0,
      lastMessage: "ignored",
    }));
    const result = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(result.text).toBe("Hello");
  });

  it("没有 agent_message 时回落到 lastMessage", async () => {
    const stdout = [
      '{"type":"turn.started"}',
      '{"type":"item.completed","item":{"id":"item_x","type":"reasoning","text":"thinking"}}',
    ].join("\n");
    const model = createCodexChatLanguageModel("codex-chat", async () => ({
      stdout,
      stderr: "",
      exitCode: 0,
      lastMessage: "fallback body",
    }));
    const result = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(result.text).toBe("fallback body");
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
