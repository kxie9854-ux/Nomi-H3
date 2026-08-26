import { describe, expect, it } from "vitest"
import {
  DIRECTOR_MAX_OVERLAY_SKILLS,
  normalizeDirectorSkillIds,
  parseDirectorSkillMode,
  readDirectorSkillIds,
  readDirectorSkillMode,
  toggleDirectorSkillId,
  writeDirectorSkillIds,
  writeDirectorSkillMode,
} from "./directorSkillSelection"

describe("director skill selection", () => {
  it("drops the spine id, junk, and extras past the cap", () => {
    expect(normalizeDirectorSkillIds([
      "h3-autodl-art-director",
      "director-guzhuang",
      "../x",
      "director-sound",
      "director-action",
      "director-staging",
    ])).toEqual(["director-guzhuang", "director-sound", "director-action"])
  })

  it("toggles on, off, and replaces the oldest when full", () => {
    const first = toggleDirectorSkillId([], "director-guzhuang")
    expect(first).toEqual(["director-guzhuang"])
    expect(toggleDirectorSkillId(first, "director-guzhuang")).toEqual([])
    let ids = ["a", "b", "c"]
    ids = toggleDirectorSkillId(ids, "d")
    expect(ids).toEqual(["b", "c", "d"])
    expect(ids).toHaveLength(DIRECTOR_MAX_OVERLAY_SKILLS)
  })

  it("round-trips selected ids per project", () => {
    writeDirectorSkillIds("project-1", ["director-guzhuang", "nope/path"])
    expect(readDirectorSkillIds("project-1")).toEqual(["director-guzhuang"])
    expect(readDirectorSkillIds("project-2")).toEqual([])
  })

  it("defaults to film and round-trips none/author", () => {
    expect(parseDirectorSkillMode("nope")).toBe("film")
    expect(readDirectorSkillMode("project-mode")).toBe("film")
    expect(writeDirectorSkillMode("project-mode", "none")).toBe("none")
    expect(readDirectorSkillMode("project-mode")).toBe("none")
    expect(writeDirectorSkillMode("project-mode", "author")).toBe("author")
    expect(readDirectorSkillMode("project-mode")).toBe("author")
  })
})
