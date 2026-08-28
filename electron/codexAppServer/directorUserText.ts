/**
 * Director user-text wrapper.
 * The pin/canvas header is still sent to Codex (same semantics as before).
 * Stable markers let history reads strip it; legacy unwrapped threads stay compatible.
 */

export const DIRECTOR_CONTEXT_OPEN = "<<<NOMI_DIRECTOR_CONTEXT";
export const DIRECTOR_CONTEXT_CLOSE = "NOMI_DIRECTOR_CONTEXT>>>";

const LEGACY_PIN_LINE_2 = "所有 nomi_add_nodes / nomi_read_canvas / nomi_generate 必须用这个 projectId。";
const LEGACY_PIN_LINE_3 = "不要新建项目，不要换到最近更新的其它项目。";
const LEGACY_PIN_PREFIX = /^当前打开的 Nomi 画布项目 id 是 [^\n]+。\r?\n所有 nomi_add_nodes \/ nomi_read_canvas \/ nomi_generate 必须用这个 projectId。\r?\n不要新建项目，不要换到最近更新的其它项目。\r?\n/;
const LEGACY_CANVAS_CONTEXT_PREFIX = /^(?:没有选中节点。|用户选中 \d+ 个节点。)/;

export function directorProjectPinLines(projectId: string): string[] {
  return [
    `当前打开的 Nomi 画布项目 id 是 ${projectId}。`,
    LEGACY_PIN_LINE_2,
    LEGACY_PIN_LINE_3,
  ];
}

export function wrapDirectorUserText(
  text: string,
  projectIdOrOptions?: string | { projectId?: string; canvasContext?: string },
): string {
  const options = typeof projectIdOrOptions === "string"
    ? { projectId: projectIdOrOptions, canvasContext: "" }
    : (projectIdOrOptions || {});
  const id = typeof options.projectId === "string" ? options.projectId.trim() : "";
  const canvas = typeof options.canvasContext === "string" ? options.canvasContext.trim() : "";
  const header: string[] = [];
  if (id) header.push(...directorProjectPinLines(id));
  if (canvas) {
    if (header.length) header.push("");
    header.push(canvas);
  }
  if (!header.length) return text;
  return `${DIRECTOR_CONTEXT_OPEN}\n${header.join("\n")}\n${DIRECTOR_CONTEXT_CLOSE}\n\n${text}`;
}

export function unwrapDirectorUserText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const marked = unwrapMarkedDirectorUserText(raw);
  if (marked !== null) return marked;
  return unwrapLegacyDirectorUserText(raw);
}

function unwrapMarkedDirectorUserText(raw: string): string | null {
  const open = raw.indexOf(DIRECTOR_CONTEXT_OPEN);
  if (open === -1) return null;
  const close = raw.indexOf(DIRECTOR_CONTEXT_CLOSE, open + DIRECTOR_CONTEXT_OPEN.length);
  if (close === -1) return null;
  return raw.slice(close + DIRECTOR_CONTEXT_CLOSE.length).replace(/^\r?\n+/, "");
}

/**
 * Pre-marker wrap was `${header.join("\\n")}\\n\\n${text}` with header =
 * pin lines, optionally plus `""` + canvas. After stripping the pin, a remaining
 * `\\n\\n` is treated as canvas | user (last segment = user) so canvasContext
 * does not leak. New markers preserve user text that itself contains blank lines.
 */
function unwrapLegacyDirectorUserText(raw: string): string {
  const match = raw.match(LEGACY_PIN_PREFIX);
  if (!match) return raw;
  let rest = raw.slice(match[0].length);
  if (rest.startsWith("\n")) rest = rest.slice(1);
  // The old wrapper always pinned the three project lines, but canvas context was optional.
  // Without canvas context the whole remainder is user-authored and may itself contain blank
  // paragraphs; using lastIndexOf unconditionally would silently discard those paragraphs.
  if (!LEGACY_CANVAS_CONTEXT_PREFIX.test(rest)) return rest;
  // Old canvasContext had no closing marker, so its final blank-line boundary is inherently
  // ambiguous. Prefer not leaking canvas/project data; all new turns use the lossless markers.
  const split = rest.lastIndexOf("\n\n");
  if (split === -1) return rest;
  return rest.slice(split + 2);
}
