import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DIRECTOR_AUTHOR_ID,
  DIRECTOR_MAX_OVERLAY_SKILLS,
  DIRECTOR_SPINE_ID,
  extraSkillInputs,
  importDirectorSkillMarkdown,
  listDirectorSkills,
  resolveDirectorSkills,
  resolveTurnSkills,
  sanitizeImportedSkillId,
} from "./directorSkills";

const tempDirs: string[] = [];

function tempRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nomi-director-skills-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("sanitizeImportedSkillId", () => {
  it("accepts a skill folder name and prefixes collisions with bundled ids", () => {
    expect(sanitizeImportedSkillId("My Film Pack")).toBe("my-film-pack");
    expect(sanitizeImportedSkillId("director-guzhuang")).toBe("user-director-guzhuang");
    expect(sanitizeImportedSkillId(DIRECTOR_SPINE_ID)).toBeNull();
    expect(sanitizeImportedSkillId(DIRECTOR_AUTHOR_ID)).toBeNull();
    expect(sanitizeImportedSkillId("../etc/passwd")).toBeNull();
  });
});

describe("list/resolve/import director skills", () => {
  const appPath = path.resolve(__dirname, "../..");

  it("lists the H3 spine first and bundled templates that exist on disk", () => {
    const skills = listDirectorSkills(appPath);
    expect(skills[0]).toMatchObject({ id: DIRECTOR_SPINE_ID, spine: true, origin: "builtin" });
    expect(skills.some((item) => item.id === "director-guzhuang" && !item.spine)).toBe(true);
  });

  it("resolves overlays in order, skips the spine, unknown ids, and caps at three", () => {
    const refs = resolveDirectorSkills(appPath, undefined, [
      DIRECTOR_SPINE_ID,
      "director-guzhuang",
      "nope",
      "director-cinematography",
      "director-sound",
      "director-action",
    ]);
    expect(refs).toHaveLength(DIRECTOR_MAX_OVERLAY_SKILLS);
    expect(refs.map((item) => item.name)).toEqual([
      "director.guzhuang",
      "director.cinematography",
      "director.sound",
    ]);
    expect(refs.every((item) => fs.existsSync(item.path))).toBe(true);
  });

  it("imports a SKILL.md into userData and resolves it on the next list", () => {
    const settingsRoot = tempRoot();
    const imported = importDirectorSkillMarkdown(
      settingsRoot,
      "---\nname: night-market\ndescription: Night market short.\n---\n\n# Night market\n",
      "Night Market.md",
    );
    expect(imported).toMatchObject({ id: "night-market", origin: "user", spine: false });
    const listed = listDirectorSkills(appPath, settingsRoot);
    expect(listed.some((item) => item.id === "night-market")).toBe(true);
    const refs = resolveDirectorSkills(appPath, settingsRoot, ["night-market"]);
    expect(refs).toEqual([{ name: "night-market", path: expect.stringContaining(`${path.sep}night-market${path.sep}SKILL.md`) }]);
  });

  it("resolveTurnSkills attaches nothing / author / spine+overlays", () => {
    expect(resolveTurnSkills(appPath, undefined, "none", ["director-guzhuang"])).toEqual([]);
    const author = resolveTurnSkills(appPath, undefined, "author", ["director-guzhuang"]);
    expect(author).toEqual([{ name: DIRECTOR_AUTHOR_ID, path: expect.stringContaining(`${path.sep}${DIRECTOR_AUTHOR_ID}${path.sep}SKILL.md`) }]);
    const film = resolveTurnSkills(appPath, undefined, "film", ["director-guzhuang"]);
    expect(film[0]).toMatchObject({ name: DIRECTOR_SPINE_ID });
    expect(film.some((item) => item.name === "director.guzhuang")).toBe(true);
  });

  it("dedupes extra skill inputs against the spine path", () => {
    expect(extraSkillInputs(
      [{ name: "a", path: "/skill.md" }, { name: "b", path: "/other.md" }],
      "/skill.md",
    )).toEqual([{ type: "skill", name: "b", path: "/other.md" }]);
  });
});
