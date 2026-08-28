import { describe, expect, it } from "vitest";
import {
  DIRECTOR_CONTEXT_CLOSE,
  DIRECTOR_CONTEXT_OPEN,
  unwrapDirectorUserText,
  wrapDirectorUserText,
} from "./directorUserText";

function wrapLegacy(
  text: string,
  projectId: string,
  canvasContext = "",
): string {
  const header = [
    `当前打开的 Nomi 画布项目 id 是 ${projectId}。`,
    "所有 nomi_add_nodes / nomi_read_canvas / nomi_generate 必须用这个 projectId。",
    "不要新建项目，不要换到最近更新的其它项目。",
  ];
  if (canvasContext) header.push("", canvasContext);
  return `${header.join("\n")}\n\n${text}`;
}

describe("wrapDirectorUserText", () => {
  it("pins MCP writes to the open canvas project without dropping the user text", () => {
    const wrapped = wrapDirectorUserText("生成小猫", "project-1");
    expect(wrapped).toContain("project-1");
    expect(wrapped).toContain("生成小猫");
    expect(wrapped).toContain(DIRECTOR_CONTEXT_OPEN);
    expect(wrapped).toContain(DIRECTOR_CONTEXT_CLOSE);
    expect(wrapDirectorUserText("生成小猫", "")).toBe("生成小猫");
  });

  it("attaches selected-canvas context for iterate-this-shot", () => {
    const wrapped = wrapDirectorUserText("改这镜", { projectId: "p1", canvasContext: "选中 node-cat" });
    expect(wrapped).toContain("p1");
    expect(wrapped).toContain("选中 node-cat");
    expect(wrapped).toContain("改这镜");
    expect(wrapped.indexOf("选中 node-cat")).toBeLessThan(wrapped.indexOf(DIRECTOR_CONTEXT_CLOSE));
    expect(wrapped.indexOf("改这镜")).toBeGreaterThan(wrapped.indexOf(DIRECTOR_CONTEXT_CLOSE));
  });
});

describe("unwrapDirectorUserText", () => {
  it("restores original user text from the marked wrapper", () => {
    const user = "改这镜\n\n第二段";
    const wrapped = wrapDirectorUserText(user, { projectId: "p1", canvasContext: "选中 node-cat" });
    expect(unwrapDirectorUserText(wrapped)).toBe(user);
    expect(unwrapDirectorUserText(wrapped)).not.toContain("p1");
    expect(unwrapDirectorUserText(wrapped)).not.toContain("选中 node-cat");
    expect(unwrapDirectorUserText(wrapped)).not.toContain(DIRECTOR_CONTEXT_OPEN);
  });

  it("strips the legacy pin header and canvasContext", () => {
    const canvas = "用户选中 1 个节点。说「改这镜」时只操作 node-cat。\n\n画布节点 1 个(id | 类型 | 标题 | 状态 | prompt 摘要):\n- node-cat | image | 小猫\n引用边: 无\n当前选中: node-cat";
    const legacy = wrapLegacy("改这镜", "project-1787501041770-jivtcp", canvas);
    expect(legacy).not.toContain(DIRECTOR_CONTEXT_OPEN);
    expect(unwrapDirectorUserText(legacy)).toBe("改这镜");
    expect(unwrapDirectorUserText(legacy)).not.toContain("project-1787501041770-jivtcp");
    expect(unwrapDirectorUserText(legacy)).not.toContain("node-cat");
    expect(unwrapDirectorUserText(legacy)).not.toContain("nomi_add_nodes");
  });

  it("strips a legacy pin without canvas", () => {
    expect(unwrapDirectorUserText(wrapLegacy("生成小猫", "project-1"))).toBe("生成小猫");
    expect(unwrapDirectorUserText(wrapLegacy("第一段\n\n第二段", "project-1"))).toBe("第一段\n\n第二段");
  });

  it("leaves unwrapped user text and unknown values alone", () => {
    expect(unwrapDirectorUserText("直接说一句")).toBe("直接说一句");
    expect(unwrapDirectorUserText("")).toBe("");
    expect(unwrapDirectorUserText(null)).toBe("");
    expect(unwrapDirectorUserText({ text: "x" })).toBe("");
  });
});
