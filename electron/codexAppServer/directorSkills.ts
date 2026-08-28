import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DIRECTOR_SPINE_ID = "h3-autodl-art-director";
export const DIRECTOR_AUTHOR_ID = "director-skill-author";
export const DIRECTOR_MAX_OVERLAY_SKILLS = 3;
export type DirectorSkillMode = "none" | "film" | "author";
const IMPORTED_SKILLS_RELATIVE = path.join("codex-director", "imported-skills");
const MAX_SKILL_MARKDOWN_BYTES = 256 * 1024;

export type DirectorSkillOrigin = "builtin" | "user";

export type DirectorSkillDto = {
  id: string
  name: string
  label: string
  description: string
  origin: DirectorSkillOrigin
  spine: boolean
}

export type DirectorSkillRef = {
  name: string
  path: string
}

export const DIRECTOR_TEMPLATE_CATALOG = [
  { id: "director-guzhuang", dir: "director-guzhuang", name: "director.guzhuang" },
  { id: "director-cinematography", dir: "director-cinematography", name: "director.cinematography" },
  { id: "director-performance", dir: "director-performance", name: "director.performance" },
  { id: "director-sound", dir: "director-sound", name: "director.sound" },
  { id: "director-action", dir: "director-action", name: "director.action" },
  { id: "director-art-design", dir: "director-art-design", name: "director.art-design" },
  { id: "director-staging", dir: "director-staging", name: "director.staging" },
  { id: "director-consistency", dir: "director-consistency", name: "director.consistency" },
  { id: "director-transitions", dir: "director-transitions", name: "director.transitions" },
  { id: "director-style-otomo-wright", dir: "director-style-otomo-wright", name: "director.style-otomo-wright" },
] as const;

export function bundledSkillsRoot(appPath: string): string {
  return path.join(appPath, "skills");
}

export function spineSkillPath(appPath: string): string {
  return path.join(bundledSkillsRoot(appPath), DIRECTOR_SPINE_ID, "SKILL.md");
}

export function authorSkillPath(appPath: string): string {
  return path.join(bundledSkillsRoot(appPath), DIRECTOR_AUTHOR_ID, "SKILL.md");
}

export function parseDirectorSkillMode(raw: unknown): DirectorSkillMode {
  return raw === "none" || raw === "author" ? raw : "film";
}

export function importedSkillsRoot(settingsRoot: string): string {
  if (!path.isAbsolute(settingsRoot)) {
    throw new Error("imported director skills require an absolute settings root");
  }
  const resolved = path.resolve(settingsRoot, IMPORTED_SKILLS_RELATIVE);
  assertInsideRoot(settingsRoot, resolved);
  return resolved;
}

export function normalizeDirectorSkillId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > 80) return null;
  if (id === "." || id === ".." || id.includes("..") || id.includes("/") || id.includes("\\") || id.includes("\0")) {
    return null;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) return null;
  return id;
}

export function sanitizeImportedSkillId(raw: string): string | null {
  const collapsed = raw.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  const id = normalizeDirectorSkillId(collapsed);
  if (!id || id === DIRECTOR_SPINE_ID || id === DIRECTOR_AUTHOR_ID) return null;
  if (DIRECTOR_TEMPLATE_CATALOG.some((item) => item.id === id)) return `user-${id}`;
  return id;
}

function assertInsideRoot(root: string, candidate: string): void {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(candidate);
  const prefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix)) {
    throw new Error("director skill path escaped its root");
  }
}

function readSkillMarkdown(filePath: string): string {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return "";
  const buf = fs.readFileSync(filePath);
  if (buf.byteLength > MAX_SKILL_MARKDOWN_BYTES) return "";
  return buf.toString("utf8");
}

function parseFrontmatterField(markdown: string, field: string): string {
  const match = markdown.match(/^---\s*\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1] || "";
  const line = frontmatter.match(new RegExp(`^${field}:\\s*["']?(.+?)["']?\\s*$`, "m"));
  return String(line?.[1] || "").trim();
}

function spineDto(appPath: string): DirectorSkillDto {
  const filePath = spineSkillPath(appPath);
  const markdown = readSkillMarkdown(filePath);
  return {
    id: DIRECTOR_SPINE_ID,
    name: DIRECTOR_SPINE_ID,
    label: parseFrontmatterField(markdown, "name") || DIRECTOR_SPINE_ID,
    description: parseFrontmatterField(markdown, "description"),
    origin: "builtin",
    spine: true,
  };
}

function builtinTemplateDto(appPath: string, id: string, dir: string, name: string): DirectorSkillDto | null {
  const filePath = path.join(bundledSkillsRoot(appPath), dir, "SKILL.md");
  if (!fs.existsSync(filePath)) return null;
  const markdown = readSkillMarkdown(filePath);
  return {
    id,
    name,
    label: parseFrontmatterField(markdown, "name") || id,
    description: parseFrontmatterField(markdown, "description"),
    origin: "builtin",
    spine: false,
  };
}

function listImportedSkills(settingsRoot: string): DirectorSkillDto[] {
  const root = importedSkillsRoot(settingsRoot);
  if (!fs.existsSync(root)) return [];
  const out: DirectorSkillDto[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = normalizeDirectorSkillId(entry.name);
    if (!id) continue;
    const filePath = path.join(root, entry.name, "SKILL.md");
    assertInsideRoot(root, filePath);
    const markdown = readSkillMarkdown(filePath);
    if (!markdown.trim()) continue;
    out.push({
      id,
      name: parseFrontmatterField(markdown, "name") || id,
      label: parseFrontmatterField(markdown, "name") || id,
      description: parseFrontmatterField(markdown, "description"),
      origin: "user",
      spine: false,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export function listDirectorSkills(appPath: string, settingsRoot?: string): DirectorSkillDto[] {
  const templates = DIRECTOR_TEMPLATE_CATALOG
    .map((item) => builtinTemplateDto(appPath, item.id, item.dir, item.name))
    .filter((item): item is DirectorSkillDto => Boolean(item));
  const imported = settingsRoot ? listImportedSkills(settingsRoot) : [];
  return [spineDto(appPath), ...templates, ...imported];
}

function skillFilePath(
  appPath: string,
  settingsRoot: string | undefined,
  item: DirectorSkillDto,
): string | null {
  if (item.origin === "builtin") {
    const dir = DIRECTOR_TEMPLATE_CATALOG.find((row) => row.id === item.id)?.dir;
    return dir ? path.join(bundledSkillsRoot(appPath), dir, "SKILL.md") : null;
  }
  if (!settingsRoot) return null;
  return path.join(importedSkillsRoot(settingsRoot), item.id, "SKILL.md");
}

export function resolveDirectorSkills(
  appPath: string,
  settingsRoot: string | undefined,
  ids: readonly string[],
): DirectorSkillRef[] {
  const catalog = listDirectorSkills(appPath, settingsRoot);
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const seen = new Set<string>();
  const refs: DirectorSkillRef[] = [];
  for (const raw of ids) {
    if (refs.length >= DIRECTOR_MAX_OVERLAY_SKILLS) break;
    const id = normalizeDirectorSkillId(raw);
    if (!id || id === DIRECTOR_SPINE_ID || seen.has(id)) continue;
    const item = byId.get(id);
    if (!item || item.spine) continue;
    const filePath = skillFilePath(appPath, settingsRoot, item);
    if (!filePath || !fs.existsSync(filePath)) continue;
    seen.add(id);
    refs.push({ name: item.name, path: filePath });
  }
  return refs;
}

export function extraSkillInputs(
  extraSkills: readonly DirectorSkillRef[],
  spinePath: string,
): Array<{ type: "skill"; name: string; path: string }> {
  return skillInputItems([
    ...(spinePath.trim() ? [{ name: DIRECTOR_SPINE_ID, path: spinePath }] : []),
    ...extraSkills,
  ]).slice(spinePath.trim() ? 1 : 0);
}

export function skillInputItems(
  skills: readonly DirectorSkillRef[],
): Array<{ type: "skill"; name: string; path: string }> {
  const seen = new Set<string>();
  const out: Array<{ type: "skill"; name: string; path: string }> = [];
  for (const skill of skills) {
    if (!skill.name.trim() || !skill.path.trim()) continue;
    const resolved = path.resolve(skill.path);
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    out.push({ type: "skill", name: skill.name, path: skill.path });
  }
  return out;
}

export function resolveTurnSkills(
  appPath: string,
  settingsRoot: string | undefined,
  mode: DirectorSkillMode,
  overlayIds: readonly string[],
): DirectorSkillRef[] {
  if (mode === "none") return [];
  if (mode === "author") {
    const filePath = authorSkillPath(appPath);
    return fs.existsSync(filePath) ? [{ name: DIRECTOR_AUTHOR_ID, path: filePath }] : [];
  }
  return [
    { name: DIRECTOR_SPINE_ID, path: spineSkillPath(appPath) },
    ...resolveDirectorSkills(appPath, settingsRoot, overlayIds),
  ];
}

export function importDirectorSkillMarkdown(
  settingsRoot: string,
  markdown: string,
  fileName?: string,
): DirectorSkillDto {
  const body = markdown.replace(/^\uFEFF/, "");
  if (!body.trim()) throw new Error("SKILL.md 是空的");
  if (Buffer.byteLength(body, "utf8") > MAX_SKILL_MARKDOWN_BYTES) throw new Error("SKILL.md 太大");
  const fromFrontmatter = parseFrontmatterField(body, "name");
  const fromFile = typeof fileName === "string" ? path.basename(fileName, path.extname(fileName)) : "";
  // 名字候选逐个清洗，而不是只取第一个非空的：frontmatter 写中文名（如 name: 夜市）时清洗不出
  // ASCII id，直接整个拒绝导入——文件名其实合法。两个候选都洗不出时用内容哈希兜底，让「导入」
  // 这个动作不因名字不是 ASCII 而失败；同内容重导得到同一 id（幂等覆盖，不翻倍）。
  const fallbackId = `skill-${createHash("sha256").update(body).digest("hex").slice(0, 8)}`;
  const id = sanitizeImportedSkillId(fromFrontmatter) || sanitizeImportedSkillId(fromFile) || fallbackId;
  const root = importedSkillsRoot(settingsRoot);
  fs.mkdirSync(root, { recursive: true });
  const destDir = path.join(root, id);
  assertInsideRoot(root, destDir);
  fs.mkdirSync(destDir, { recursive: true });
  const dest = path.join(destDir, "SKILL.md");
  assertInsideRoot(destDir, dest);
  fs.writeFileSync(dest, body, "utf8");
  return {
    id,
    name: fromFrontmatter || id,
    label: fromFrontmatter || id,
    description: parseFrontmatterField(body, "description"),
    origin: "user",
    spine: false,
  };
}
