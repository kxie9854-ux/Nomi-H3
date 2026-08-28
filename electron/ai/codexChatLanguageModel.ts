import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1StreamPart,
} from "ai";
import {
  buildCodexSpawnEnv,
  buildCodexSpawnInvocation,
  needsCmdWrapper,
  resolveCodexBin,
} from "../catalog/codexCli";
import {
  extractCodexAgentMessageSnapshotFromLine,
  extractCodexTurnErrorFromLine,
  flattenCodexChatPrompt,
  parseCodexChatToolCalls,
  stripCodexChatToolFences,
  type CodexChatImage,
} from "./codexChatPrompt";

type CodexChatFinishReason = Awaited<ReturnType<LanguageModelV1["doGenerate"]>>["finishReason"];
type CodexChatToolCall = NonNullable<Awaited<ReturnType<LanguageModelV1["doGenerate"]>>["toolCalls"]>[number];

export type CodexChatRunInput = {
  prompt: string;
  images: CodexChatImage[];
  abortSignal?: AbortSignal;
  onJsonlLine?: (line: string) => void;
};

export type CodexChatRunResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  lastMessage: string;
};

export type CodexChatRun = (input: CodexChatRunInput) => Promise<CodexChatRunResult>;

function extensionForMime(mimeType: string): string {
  if (/jpe?g/i.test(mimeType)) return ".jpg";
  if (/webp/i.test(mimeType)) return ".webp";
  if (/gif/i.test(mimeType)) return ".gif";
  return ".png";
}

function describeCodexChatFailure(result: CodexChatRunResult, turnError: string): string {
  const text = `${result.stdout}\n${result.stderr}\n${turnError}\n${result.lastMessage}`;
  if (/not logged in|login required|codex login|unauthorized|401/i.test(text)) {
    return "Codex CLI 未登录或登录态失效，请先在终端运行 codex login。";
  }
  if (/ENOENT|未找到 Codex CLI/i.test(text) || (result.exitCode === -2 && !result.stdout)) {
    return "未找到 Codex CLI（codex）。请确认本机已安装并登录，或设置 CODEX_BIN 指向可执行文件。";
  }
  if (turnError) return `Codex 对话失败：${turnError}`;
  const stderr = result.stderr.replace(/\s+/g, " ").trim().slice(0, 300);
  if (result.exitCode !== 0 && stderr) return `Codex 对话失败：${stderr}`;
  return "Codex CLI 没有返回对话内容。";
}

function collectAgentText(stdout: string, lastMessage: string): string {
  const order: string[] = [];
  const byKey = new Map<string, { text: string; completed: boolean }>();
  let anonSeq = 0;
  for (const line of stdout.split(/\r?\n/)) {
    const snapshot = extractCodexAgentMessageSnapshotFromLine(line);
    if (!snapshot) continue;
    const key = snapshot.itemId ?? `__anon:${anonSeq++}`;
    const prev = byKey.get(key);
    if (!prev) {
      order.push(key);
      byKey.set(key, { text: snapshot.text, completed: snapshot.completed });
      continue;
    }
    // Prefer completed; otherwise keep the last updated/untyped snapshot.
    if (prev.completed && !snapshot.completed) continue;
    prev.text = snapshot.text;
    prev.completed = prev.completed || snapshot.completed;
  }
  const messages = order
    .map((key) => byKey.get(key)?.text ?? "")
    .filter(Boolean);
  return (messages.join("\n") || lastMessage).trim();
}

function collectTurnError(stdout: string, stderr: string): string {
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const error = extractCodexTurnErrorFromLine(line);
    if (error) return error;
  }
  return "";
}

/** 没声明工具时回空集（而非 undefined）：围栏只有点名了已声明的工具才算数——纯聊天里模型
 * 冒出来的围栏既不该变成 tool-call（工具不存在，AI SDK 会拒），也不该被静默剥掉。 */
function allowedToolNames(options: LanguageModelV1CallOptions): Set<string> {
  if (options.mode.type !== "regular" || !options.mode.tools) return new Set();
  return new Set(
    options.mode.tools
      .filter((tool) => tool.type === "function")
      .map((tool) => tool.name),
  );
}

function toToolCalls(
  text: string,
  allowedNames: ReadonlySet<string>,
): CodexChatToolCall[] {
  return parseCodexChatToolCalls(text, allowedNames).map((call, index) => ({
    toolCallType: "function" as const,
    toolCallId: `codex-chat-${index + 1}`,
    toolName: call.toolName,
    args: call.argsText,
  }));
}

export function buildCodexChatExecArgs(workDir: string, lastMessagePath: string, imagePaths: string[]): string[] {
  return [
    "-c", "service_tier='fast'",
    "--ask-for-approval", "never",
    "exec",
    "--json",
    "--ephemeral",
    "--sandbox", "read-only",
    "--skip-git-repo-check",
    "-C", workDir,
    "-o", lastMessagePath,
    ...imagePaths.flatMap((imagePath) => ["-i", imagePath]),
    "-",
  ];
}

export async function defaultCodexChatRun(input: CodexChatRunInput): Promise<CodexChatRunResult> {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "nomi-codex-chat-"));
  mkdirSync(workDir, { recursive: true });
  const lastMessagePath = path.join(workDir, "last-message.txt");
  const imagePaths: string[] = [];
  try {
    input.images.forEach((image, index) => {
      const filePath = path.join(workDir, `image-${index + 1}${extensionForMime(image.mimeType)}`);
      writeFileSync(filePath, image.bytes);
      imagePaths.push(filePath);
    });
    const args = buildCodexChatExecArgs(workDir, lastMessagePath, imagePaths);
    const bin = resolveCodexBin();
    const invocation = buildCodexSpawnInvocation(bin, args);
    return await new Promise<CodexChatRunResult>((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let pending = "";
      let settled = false;
      const child = spawn(invocation.command, invocation.args, {
        cwd: workDir,
        windowsHide: true,
        windowsVerbatimArguments: needsCmdWrapper(bin),
        env: buildCodexSpawnEnv(),
      });
      const finish = (result: CodexChatRunResult) => {
        if (settled) return;
        settled = true;
        input.abortSignal?.removeEventListener("abort", onAbort);
        resolve(result);
      };
      const fail = (error: Error) => {
        if (settled) return;
        settled = true;
        input.abortSignal?.removeEventListener("abort", onAbort);
        reject(error);
      };
      const onAbort = () => {
        child.kill("SIGTERM");
        fail(new Error("Codex 对话已取消。"));
      };
      if (input.abortSignal) {
        if (input.abortSignal.aborted) {
          onAbort();
          return;
        }
        input.abortSignal.addEventListener("abort", onAbort, { once: true });
      }
      const absorb = (chunk: unknown, kind: "stdout" | "stderr") => {
        const text = String(chunk);
        if (kind === "stderr") {
          stderr += text;
          return;
        }
        stdout += text;
        pending += text;
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() || "";
        for (const line of lines) input.onJsonlLine?.(line);
      };
      child.stdout?.on("data", (chunk) => absorb(chunk, "stdout"));
      child.stderr?.on("data", (chunk) => absorb(chunk, "stderr"));
      child.stdin?.end(input.prompt);
      child.on("error", (error) => {
        const message = (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "未找到 Codex CLI（codex）。请确认本机已安装并登录，或设置 CODEX_BIN 指向可执行文件。"
          : error.message || String(error);
        fail(new Error(message));
      });
      child.on("close", (code) => {
        if (pending.trim()) input.onJsonlLine?.(pending);
        let lastMessage = "";
        try {
          if (existsSync(lastMessagePath)) lastMessage = readFileSync(lastMessagePath, "utf8");
        } catch {
          lastMessage = "";
        }
        finish({
          stdout,
          stderr,
          exitCode: code ?? -1,
          lastMessage,
        });
      });
    });
  } finally {
    try { rmSync(workDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }
}

function completionFromRun(
  options: LanguageModelV1CallOptions,
  result: CodexChatRunResult,
): { text: string; toolCalls: CodexChatToolCall[]; finishReason: CodexChatFinishReason } {
  const raw = collectAgentText(result.stdout, result.lastMessage);
  const turnError = collectTurnError(result.stdout, result.stderr);
  if (!raw) throw new Error(describeCodexChatFailure(result, turnError));
  const allowed = allowedToolNames(options);
  const toolCalls = toToolCalls(raw, allowed);
  return {
    text: stripCodexChatToolFences(raw, allowed),
    toolCalls,
    finishReason: toolCalls.length > 0 ? "tool-calls" : "stop",
  };
}

export function createCodexChatLanguageModel(
  modelId: string,
  run: CodexChatRun = defaultCodexChatRun,
): LanguageModelV1 {
  return {
    specificationVersion: "v1",
    provider: "codex-local",
    modelId,
    defaultObjectGenerationMode: undefined,
    supportsImageUrls: false,
    async doGenerate(options) {
      const flattened = flattenCodexChatPrompt(options);
      const result = await run({
        prompt: flattened.prompt,
        images: flattened.images,
        abortSignal: options.abortSignal,
      });
      const completion = completionFromRun(options, result);
      return {
        ...(completion.text ? { text: completion.text } : {}),
        ...(completion.toolCalls.length ? { toolCalls: completion.toolCalls } : {}),
        finishReason: completion.finishReason,
        usage: { promptTokens: 0, completionTokens: 0 },
        rawCall: { rawPrompt: flattened.prompt, rawSettings: { bin: "codex", mode: "exec" } },
      };
    },
    async doStream(options) {
      const flattened = flattenCodexChatPrompt(options);
      const stream = new ReadableStream<LanguageModelV1StreamPart>({
        async start(controller) {
          try {
            const result = await run({
              prompt: flattened.prompt,
              images: flattened.images,
              abortSignal: options.abortSignal,
            });
            const completion = completionFromRun(options, result);
            if (completion.text) controller.enqueue({ type: "text-delta", textDelta: completion.text });
            for (const toolCall of completion.toolCalls) {
              controller.enqueue({ type: "tool-call", ...toolCall });
            }
            controller.enqueue({
              type: "finish",
              finishReason: completion.finishReason,
              usage: { promptTokens: 0, completionTokens: 0 },
            });
            controller.close();
          } catch (error) {
            controller.error(error);
          }
        },
      });
      return {
        stream,
        rawCall: { rawPrompt: flattened.prompt, rawSettings: { bin: "codex", mode: "exec" } },
      };
    },
  };
}
