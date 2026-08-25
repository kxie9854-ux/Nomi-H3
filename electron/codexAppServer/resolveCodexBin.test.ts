import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import os from "node:os";
import { CHATGPT_BUNDLED_CODEX, resolveCodexBin } from "./resolveCodexBin";
import { createNdjsonParser, encodeNdjson, requestFrame } from "./ndjsonRpc";

describe("resolveCodexBin", () => {
  it("prefers the ChatGPT.app bundled binary when present", () => {
    const found = resolveCodexBin(os.homedir(), "darwin");
    if (existsSync(CHATGPT_BUNDLED_CODEX)) expect(found).toBe(CHATGPT_BUNDLED_CODEX);
    else expect(found === null || found.endsWith("/codex")).toBe(true);
  });
});

describe("ndjsonRpc", () => {
  it("encodes one JSON object per line", () => {
    expect(encodeNdjson({ id: 1, method: "initialize" }).toString("utf8")).toBe(
      '{"id":1,"method":"initialize"}\n',
    );
  });

  it("parses multiple frames from chunked bytes", () => {
    const messages: unknown[] = [];
    const push = createNdjsonParser((message) => messages.push(message));
    push(Buffer.from('{"id":1,"method":"initialize"}'));
    push(Buffer.from('\n{"method":"thread/started","params":{"threadId":"t"}}\n'));
    expect(messages).toEqual([
      { id: 1, method: "initialize" },
      { method: "thread/started", params: { threadId: "t" } },
    ]);
  });

  it("omits params when undefined", () => {
    expect(requestFrame(2, "account/logout")).toEqual({ id: 2, method: "account/logout" });
  });
});
