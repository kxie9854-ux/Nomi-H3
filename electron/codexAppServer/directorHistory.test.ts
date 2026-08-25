import { describe, expect, it } from "vitest";
import {
  DIRECTOR_HISTORY_VISIBLE_LIMIT,
  directorThreadReadHistoryParams,
  inspectDirectorThreadRead,
  limitDirectorHistoryLines,
  type DirectorHistoryLine,
} from "./directorHistory";
import { wrapDirectorUserText } from "./directorUserText";

function wrapLegacy(text: string, projectId: string, canvasContext = ""): string {
  const header = [
    `当前打开的 Nomi 画布项目 id 是 ${projectId}。`,
    "所有 nomi_add_nodes / nomi_read_canvas / nomi_generate 必须用这个 projectId。",
    "不要新建项目，不要换到最近更新的其它项目。",
  ];
  if (canvasContext) header.push("", canvasContext);
  return `${header.join("\n")}\n\n${text}`;
}

function officialRead(turns: unknown[]) {
  return { thread: { id: "thr-a", turns } };
}

describe("directorThreadReadHistoryParams", () => {
  it("always asks for includeTurns", () => {
    expect(directorThreadReadHistoryParams("thr_1")).toEqual({ threadId: "thr_1", includeTurns: true });
  });
});

describe("inspectDirectorThreadRead", () => {
  it("projects official user/agent items in turn/item order", () => {
    const result = inspectDirectorThreadRead(officialRead([
      {
        id: "turn-1",
        items: [
          {
            id: "u1",
            type: "userMessage",
            content: [{ type: "text", text: wrapDirectorUserText("生成小猫", "project-a") }],
          },
          { id: "r1", type: "reasoning", text: "内部推理" },
          { id: "a1", type: "agentMessage", text: "先确认画幅" },
        ],
      },
      {
        id: "turn-2",
        items: [
          {
            id: "u2",
            type: "userMessage",
            content: [
              { type: "text", text: wrapLegacy("继续", "project-a", "没有选中节点。\n\n画布节点 3 个(id | 类型 | 标题 | 状态 | prompt 摘要):") },
              { type: "image", url: "x" },
            ],
          },
          { id: "a2", type: "agentMessage", text: "好" },
        ],
      },
    ]));
    expect(result).toEqual({
      ok: true,
      lines: [
        { id: "u1", role: "user", text: "生成小猫" },
        { id: "a1", role: "assistant", text: "先确认画幅" },
        { id: "u2", role: "user", text: "继续" },
        { id: "a2", role: "assistant", text: "好" },
      ],
    });
    const leaked = JSON.stringify(result);
    expect(leaked).not.toContain("project-a");
    expect(leaked).not.toContain("画布节点");
    expect(leaked).not.toContain("内部推理");
  });

  it("ignores tool, hook, elicitation, approval, empty, and unknown items without throwing", () => {
    const result = inspectDirectorThreadRead(officialRead([
      null,
      1,
      { id: "t1", items: "not-array" },
      {
        id: "turn-x",
        items: [
          { type: "commandExecution", command: "ls", status: "completed" },
          { type: "mcpToolCall", tool: "nomi_generate", status: "completed" },
          { type: "hook", text: "hook" },
          { type: "elicitation", requestId: "9", message: "确认消耗模型额度吗？" },
          { type: "approval", tool: "rm", status: "accepted" },
          { type: "userMessage", content: [{ type: "text", text: "   " }] },
          { type: "userMessage", content: "plain" },
          { type: "agentMessage", text: "" },
          { type: "agentMessage" },
          { type: "futureItem", text: "ignore" },
          undefined,
          { type: "userMessage", content: [{ type: "text", text: "可见" }] },
        ],
      },
    ]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines).toEqual([
      { id: "turn-x:11", role: "user", text: "可见" },
    ]);
  });

  it("treats missing turns as old schema empty history, not a throw", () => {
    expect(inspectDirectorThreadRead({ thread: { id: "thr-old" } })).toEqual({ ok: true, lines: [] });
    expect(inspectDirectorThreadRead({ thread: { id: "thr-old", turns: { items: [] } } })).toEqual({
      ok: true,
      lines: [],
    });
  });

  it("marks a missing thread payload as invalid", () => {
    expect(inspectDirectorThreadRead(null)).toEqual({ ok: false });
    expect(inspectDirectorThreadRead({})).toEqual({ ok: false });
    expect(inspectDirectorThreadRead({ thread: null })).toEqual({ ok: false });
    expect(inspectDirectorThreadRead({ turns: [] })).toEqual({ ok: false });
  });
});

describe("limitDirectorHistoryLines", () => {
  it("keeps the most recent lines and flags truncation", () => {
    const lines: DirectorHistoryLine[] = Array.from({ length: DIRECTOR_HISTORY_VISIBLE_LIMIT + 5 }, (_, i) => ({
      id: `n${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      text: `line-${i}`,
    }));
    const limited = limitDirectorHistoryLines(lines);
    expect(limited.truncated).toBe(true);
    expect(limited.lines).toHaveLength(DIRECTOR_HISTORY_VISIBLE_LIMIT);
    expect(limited.lines[0]?.text).toBe("line-5");
    expect(limited.lines.at(-1)?.text).toBe(`line-${lines.length - 1}`);
    expect(limitDirectorHistoryLines(lines.slice(0, 3))).toEqual({
      truncated: false,
      lines: lines.slice(0, 3),
    });
  });
});
