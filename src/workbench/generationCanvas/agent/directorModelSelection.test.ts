import { describe, expect, it } from "vitest"
import {
  normalizeDirectorCodexOverride,
  readDirectorCodexEffort,
  readDirectorCodexModel,
  writeDirectorCodexEffort,
  writeDirectorCodexModel,
} from "./directorModelSelection"

describe("director Codex model/effort selection", () => {
  it("treats blank, oversized, and non-tokens as inherit", () => {
    expect(normalizeDirectorCodexOverride("  ")).toBe("")
    expect(normalizeDirectorCodexOverride("x".repeat(81))).toBe("")
    expect(normalizeDirectorCodexOverride(12)).toBe("")
    expect(normalizeDirectorCodexOverride("../x")).toBe("")
    expect(normalizeDirectorCodexOverride("gpt-5.6-sol")).toBe("gpt-5.6-sol")
    expect(normalizeDirectorCodexOverride(" medium ")).toBe("medium")
  })

  it("round-trips last pick including inherit", () => {
    expect(writeDirectorCodexModel("gpt-5.4")).toBe("gpt-5.4")
    expect(readDirectorCodexModel()).toBe("gpt-5.4")
    expect(writeDirectorCodexModel("")).toBe("")
    expect(readDirectorCodexModel()).toBe("")
    expect(writeDirectorCodexEffort("high")).toBe("high")
    expect(readDirectorCodexEffort()).toBe("high")
    expect(writeDirectorCodexEffort("")).toBe("")
    expect(readDirectorCodexEffort()).toBe("")
  })
})
