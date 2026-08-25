import { FOCUS_DIRECTOR_COMPOSER_EVENT } from '../nodes/nodeSizing'

export function openDirectorFromEmptyCanvas(
  setCollapsed: (collapsed: boolean) => void,
  dispatch = typeof globalThis.dispatchEvent === 'function'
    ? (event: Event) => globalThis.dispatchEvent(event)
    : undefined,
): void {
  setCollapsed(false)
  dispatch?.(new Event(FOCUS_DIRECTOR_COMPOSER_EVENT))
}
