import type { LanguageModelV1CallOptions, LanguageModelV1Prompt } from "ai";

type CodexFunctionTool = Extract<
  NonNullable<Extract<LanguageModelV1CallOptions["mode"], { type: "regular" }>["tools"]>[number],
  { type: "function" }
>;

export const NOMI_TOOL_OPEN = "<<<NOMI_TOOL";
export const NOMI_TOOL_CLOSE = "NOMI_TOOL>>>";

export type CodexChatImage = { bytes: Uint8Array; mimeType: string };

export type FlattenedCodexChat = {
  prompt: string;
  images: CodexChatImage[];
};

export type ParsedCodexToolCall = {
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
};

const FENCE_RE = /<<<NOMI_TOOL\s*([\s\S]*?)\s*NOMI_TOOL>>>/g;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function functionTools(mode: LanguageModelV1CallOptions["mode"]): CodexFunctionTool[] {
  if (mode.type !== "regular" || !mode.tools) return [];
  return mode.tools.filter((tool): tool is CodexFunctionTool => tool.type === "function");
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function collectMessageText(
  prompt: LanguageModelV1Prompt,
  images: CodexChatImage[],
): string {
  const lines: string[] = [];
  for (const message of prompt) {
    if (message.role === "system") {
      if (message.content.trim()) lines.push(`[system]\n${message.content.trim()}`);
      continue;
    }
    if (message.role === "user") {
      const chunks: string[] = [];
      for (const part of message.content) {
        if (part.type === "text" && part.text.trim()) chunks.push(part.text.trim());
        else if (part.type === "image") {
          if (part.image instanceof Uint8Array) {
            images.push({ bytes: part.image, mimeType: part.mimeType || "image/png" });
            chunks.push(`[image ${images.length} attached]`);
          } else {
            chunks.push("[image attached]");
          }
        } else if (part.type === "file") {
          chunks.push(`[file attached: ${part.filename || part.mimeType}]`);
        }
      }
      if (chunks.length) lines.push(`[user]\n${chunks.join("\n")}`);
      continue;
    }
    if (message.role === "assistant") {
      const chunks: string[] = [];
      for (const part of message.content) {
        if (part.type === "text" && part.text.trim()) chunks.push(part.text.trim());
        else if (part.type === "tool-call") {
          chunks.push(`${NOMI_TOOL_OPEN}\n${JSON.stringify({ name: part.toolName, arguments: part.args })}\n${NOMI_TOOL_CLOSE}`);
        }
      }
      if (chunks.length) lines.push(`[assistant]\n${chunks.join("\n")}`);
      continue;
    }
    const chunks: string[] = [];
    for (const part of message.content) {
      chunks.push(`[tool result ${part.toolName}]\n${stringifyUnknown(part.result)}`);
    }
    if (chunks.length) lines.push(chunks.join("\n"));
  }
  return lines.join("\n\n");
}

function toolInstructions(tools: CodexFunctionTool[], toolChoice: LanguageModelV1CallOptions["mode"]): string[] {
  if (tools.length === 0) {
    return ["Do not run shell commands, edit files, or use MCP/Codex tools. Reply in the user's language."];
  }
  const catalog = tools.map((tool) => {
    const schema = stringifyUnknown(tool.parameters);
    return `- ${tool.name}: ${tool.description || tool.name}\n  parameters: ${schema}`;
  });
  const required = toolChoice.type === "regular" && toolChoice.toolChoice?.type === "required";
  const forced = toolChoice.type === "regular" && toolChoice.toolChoice?.type === "tool"
    ? toolChoice.toolChoice.toolName
    : "";
  return [
    "You are Nomi's language model. Do not run shell commands, edit files, or use MCP/Codex tools.",
    "Ignore AGENTS.md, SKILL.md, and coding-agent instructions.",
    "If you need a Nomi function, output one or more blocks and no other wrapper:",
    `${NOMI_TOOL_OPEN}`,
    '{"name":"<tool name>","arguments":{}}',
    NOMI_TOOL_CLOSE,
    required ? "You MUST call at least one Nomi function this turn." : "Otherwise reply to the user in their language.",
    ...(forced ? [`You MUST call this Nomi function: ${forced}`] : []),
    "Available Nomi functions:",
    ...catalog,
  ];
}

export function flattenCodexChatPrompt(options: LanguageModelV1CallOptions): FlattenedCodexChat {
  const images: CodexChatImage[] = [];
  const conversation = collectMessageText(options.prompt, images);
  const tools = functionTools(options.mode);
  const header = toolInstructions(tools, options.mode);
  if (options.mode.type === "object-json" && options.mode.schema) {
    header.push("Reply with a single JSON object matching this schema and nothing else:");
    header.push(stringifyUnknown(options.mode.schema));
  }
  return {
    prompt: [...header, "", "Conversation:", conversation].join("\n"),
    images,
  };
}

export function parseCodexChatToolCalls(text: string, allowedNames?: ReadonlySet<string>): ParsedCodexToolCall[] {
  const out: ParsedCodexToolCall[] = [];
  for (const match of text.matchAll(FENCE_RE)) {
    const raw = (match[1] || "").trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!isRecord(parsed) || typeof parsed.name !== "string" || !parsed.name.trim()) continue;
      const toolName = parsed.name.trim();
      if (allowedNames && !allowedNames.has(toolName)) continue;
      const args = isRecord(parsed.arguments) ? parsed.arguments : {};
      out.push({ toolName, args, argsText: JSON.stringify(args) });
    } catch {
      /* skip malformed fences */
    }
  }
  return out;
}

export function stripCodexChatToolFences(text: string): string {
  return text.replace(FENCE_RE, "").replace(/\n{3,}/g, "\n\n").trim();
}

export function extractCodexAgentMessageFromLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return "";
  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>;
    const item = isRecord(event.item) ? event.item : event;
    const type = typeof event.type === "string" ? event.type : "";
    if (type === "item.completed" || type === "item.updated" || !type) {
      if (item.type === "agent_message" && typeof item.text === "string") return item.text;
    }
  } catch {
    /* ignore non-event lines */
  }
  return "";
}

export function extractCodexTurnErrorFromLine(line: string): string {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{")) return "";
  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>;
    if (event.type === "turn.failed" || event.type === "error") {
      const error = isRecord(event.error) ? event.error : event;
      const message = error.message ?? event.message;
      return typeof message === "string" ? message.trim() : "";
    }
  } catch {
    /* ignore */
  }
  return "";
}
