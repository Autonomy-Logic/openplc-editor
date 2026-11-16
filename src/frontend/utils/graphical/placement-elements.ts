/**
 * Catalog of the elements that can be placed with the radial menu or with the
 * placement shortcuts (Cmd + digit on macOS, Alt + digit elsewhere), per graphical language.
 */

/** Marks the DOM elements that accept a click-to-place insertion. */
export const PLACEMENT_TARGET_ATTRIBUTE = 'data-placement-target'

export type PlacementLanguage = 'ld' | 'fbd' | 'sfc'

export type LadderPlacementElement = 'contact' | 'coil' | 'block'

export type FbdPlacementElement =
  | 'block'
  | 'input-variable'
  | 'output-variable'
  | 'connector'
  | 'continuation'
  | 'comment'

export type PlacementElementId = LadderPlacementElement | FbdPlacementElement

export type PlacementElementDescriptor = {
  id: PlacementElementId
  /** Digit pressed together with the shortcut modifier to pick the element. */
  shortcutDigit: number
}

/** Radial menu order (clockwise from the top). */
export const LADDER_PLACEMENT_ELEMENTS: readonly PlacementElementDescriptor[] = [
  { id: 'contact', shortcutDigit: 1 },
  { id: 'coil', shortcutDigit: 2 },
  { id: 'block', shortcutDigit: 3 },
]

/** Radial menu order (clockwise from the top). */
export const FBD_PLACEMENT_ELEMENTS: readonly PlacementElementDescriptor[] = [
  { id: 'block', shortcutDigit: 3 },
  { id: 'input-variable', shortcutDigit: 1 },
  { id: 'output-variable', shortcutDigit: 2 },
  { id: 'connector', shortcutDigit: 4 },
  { id: 'continuation', shortcutDigit: 5 },
  { id: 'comment', shortcutDigit: 6 },
]

const EMPTY: readonly PlacementElementDescriptor[] = []

export function getPlacementElements(language: PlacementLanguage): readonly PlacementElementDescriptor[] {
  switch (language) {
    case 'ld':
      return LADDER_PLACEMENT_ELEMENTS
    case 'fbd':
      return FBD_PLACEMENT_ELEMENTS
    case 'sfc':
      return EMPTY
    default: {
      const exhaustive: never = language
      return exhaustive
    }
  }
}

const FBD_ELEMENT_IDS: ReadonlySet<string> = new Set(FBD_PLACEMENT_ELEMENTS.map((element) => element.id))
const LADDER_ELEMENT_IDS: ReadonlySet<string> = new Set(LADDER_PLACEMENT_ELEMENTS.map((element) => element.id))

export function isFbdPlacementElement(id: string): id is FbdPlacementElement {
  return FBD_ELEMENT_IDS.has(id)
}

export function isLadderPlacementElement(id: string): id is LadderPlacementElement {
  return LADDER_ELEMENT_IDS.has(id)
}

export function findPlacementElement(
  language: PlacementLanguage,
  id: PlacementElementId,
): PlacementElementDescriptor | undefined {
  return getPlacementElements(language).find((element) => element.id === id)
}

export type ShortcutKeyEvent = Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code'>

/** Modifier of the placement shortcuts: Cmd on macOS, Alt everywhere else. */
export type ShortcutModifier = 'meta' | 'alt'

/** Shortcut modifier for a `navigator.platform` value. */
export function getShortcutModifier(platform: string): ShortcutModifier {
  return /mac/i.test(platform) ? 'meta' : 'alt'
}

/** Digit of a modifier + digit chord (top row or numpad), or `undefined` for any other key combination. */
export function getShortcutDigit(event: ShortcutKeyEvent, modifier: ShortcutModifier): number | undefined {
  const pressed = modifier === 'meta' ? event.metaKey && !event.altKey : event.altKey && !event.metaKey
  if (!pressed || event.ctrlKey || event.shiftKey) return undefined
  const match = /^(?:Digit|Numpad)([0-9])$/.exec(event.code)
  return match ? Number(match[1]) : undefined
}

export function getPlacementElementForShortcut(
  language: PlacementLanguage,
  event: ShortcutKeyEvent,
  modifier: ShortcutModifier,
): PlacementElementDescriptor | undefined {
  const digit = getShortcutDigit(event, modifier)
  if (digit === undefined) return undefined
  return getPlacementElements(language).find((element) => element.shortcutDigit === digit)
}

export function formatPlacementShortcut(element: PlacementElementDescriptor, modifier: ShortcutModifier): string {
  return `${modifier === 'meta' ? 'Cmd' : 'Alt'} + ${element.shortcutDigit}`
}

/**
 * Whether a shortcut chord may arm an element from where it was typed. Top-row digits work in text
 * fields too; with Alt, numpad digits are left to the field, since Alt + numpad enters characters on Windows.
 */
export function isShortcutAllowedFromTarget(
  event: Pick<KeyboardEvent, 'code' | 'target'>,
  modifier: ShortcutModifier,
): boolean {
  return modifier === 'meta' || !event.code.startsWith('Numpad') || !isEditableEventTarget(event.target)
}

/** True when keyboard input on `target` belongs to a text field rather than to the canvas. */
export function isEditableEventTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}
