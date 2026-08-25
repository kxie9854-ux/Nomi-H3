export type DirectorChoice = { id: string; label: string }

const CHOICE_FENCE = /:::choices\s*\n([\s\S]*?)\n:::/i
const OPEN_FENCE = /:::choices\b/i
const NUMBERED_CHOICE_LINE = /^\s*(?:([1-5])[.)、]|[（(]([1-5])[)）])\s*(\S.*?)\s*$/u
const DECISION_CUE = /(?:请(?:选择|确认|回复)|你(?:想|希望|要|选)|您(?:想|希望|要|选)|选哪|哪(?:一|个|种|项)|是否|确认|采用|继续)/u
const MAX_FALLBACK_LABEL_LENGTH = 80

function parseChoiceLine(line: string): DirectorChoice | null {
  const trimmed = line.trim().replace(/^[-*]\s*/, '')
  if (!trimmed) return null
  const sep = trimmed.indexOf('|')
  if (sep === -1) return { id: trimmed, label: trimmed }
  const id = trimmed.slice(0, sep).trim()
  const label = trimmed.slice(sep + 1).trim()
  if (!id || !label) return null
  return { id, label }
}

function parseNumberedChoiceLine(line: string): DirectorChoice | null {
  const match = line.match(NUMBERED_CHOICE_LINE)
  if (!match) return null
  const id = match[1] || match[2]
  const label = match[3].trim()
  if (!label || Array.from(label).length > MAX_FALLBACK_LABEL_LENGTH) return null
  return { id, label }
}

function parseNumberedChoiceFallback(text: string): { body: string; choices: DirectorChoice[] } {
  const normalized = text.replace(/\s+$/u, '')
  const lines = normalized.split('\n')
  let start = lines.length
  while (start > 0 && parseNumberedChoiceLine(lines[start - 1])) start -= 1
  const candidateLines = lines.slice(start)
  if (candidateLines.length < 2 || candidateLines.length > 5) return { body: normalized, choices: [] }

  const choices = candidateLines.map(parseNumberedChoiceLine)
  if (choices.some((choice, index) => !choice || choice.id !== String(index + 1))) {
    return { body: normalized, choices: [] }
  }
  const body = lines.slice(0, start).join('\n').replace(/\s+$/u, '')
  const cue = [...lines.slice(0, start)].reverse().find((line) => line.trim())?.trim() || ''
  if (!cue || !DECISION_CUE.test(cue)) return { body: normalized, choices: [] }
  return { body, choices: choices as DirectorChoice[] }
}

export function parseDirectorChoices(text: string): { body: string; choices: DirectorChoice[] } {
  const match = text.match(CHOICE_FENCE)
  if (!match || match.index === undefined) {
    if (OPEN_FENCE.test(text)) return { body: stripOpenFence(text), choices: [] }
    return parseNumberedChoiceFallback(text)
  }
  const choices: DirectorChoice[] = []
  for (const line of match[1].split('\n')) {
    const choice = parseChoiceLine(line)
    if (choice) choices.push(choice)
  }
  const body = `${text.slice(0, match.index)}${text.slice(match.index + match[0].length)}`
  return { body: stripOpenFence(body), choices }
}

/** Hide an in-progress `:::choices` fence while the assistant is still streaming. */
export function stripOpenFence(text: string): string {
  const open = text.search(OPEN_FENCE)
  if (open === -1) return text.replace(/\s+$/u, '')
  return text.slice(0, open).replace(/\s+$/u, '')
}

export function formatDirectorChoiceReply(choice: DirectorChoice): string {
  return `选项 ${choice.id}：${choice.label}`
}
