import {
  FBD_PLACEMENT_ELEMENTS,
  findPlacementElement,
  formatPlacementShortcut,
  getPlacementElementForShortcut,
  getPlacementElements,
  getShortcutDigit,
  getShortcutModifier,
  isEditableEventTarget,
  isFbdPlacementElement,
  isLadderPlacementElement,
  isShortcutAllowedFromTarget,
  LADDER_PLACEMENT_ELEMENTS,
  type ShortcutKeyEvent,
} from '../placement-elements'

const key = (code: string, overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent => ({
  altKey: true,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  code,
  ...overrides,
})

describe('placement-elements', () => {
  it('lists the ladder elements in menu order', () => {
    expect(getPlacementElements('ld').map((e) => e.id)).toEqual(['contact', 'coil', 'block'])
    expect(getPlacementElements('ld')).toBe(LADDER_PLACEMENT_ELEMENTS)
  })

  it('lists the FBD elements in menu order', () => {
    expect(getPlacementElements('fbd').map((e) => e.id)).toEqual([
      'block',
      'input-variable',
      'output-variable',
      'connector',
      'continuation',
      'comment',
    ])
    expect(getPlacementElements('fbd')).toBe(FBD_PLACEMENT_ELEMENTS)
  })

  it('has no elements for SFC', () => {
    expect(getPlacementElements('sfc')).toEqual([])
  })

  it('gives every element of a language a unique shortcut digit', () => {
    for (const language of ['ld', 'fbd'] as const) {
      const digits = getPlacementElements(language).map((e) => e.shortcutDigit)
      expect(new Set(digits).size).toBe(digits.length)
    }
  })

  it('narrows element ids per language', () => {
    expect(isFbdPlacementElement('comment')).toBe(true)
    expect(isFbdPlacementElement('contact')).toBe(false)
    expect(isLadderPlacementElement('coil')).toBe(true)
    expect(isLadderPlacementElement('comment')).toBe(false)
  })

  it('finds an element by id', () => {
    expect(findPlacementElement('fbd', 'comment')?.shortcutDigit).toBe(6)
    expect(findPlacementElement('ld', 'comment')).toBeUndefined()
  })

  describe('getShortcutModifier', () => {
    it('uses Cmd on macOS and Alt everywhere else', () => {
      expect(getShortcutModifier('MacIntel')).toBe('meta')
      expect(getShortcutModifier('Win32')).toBe('alt')
      expect(getShortcutModifier('Linux x86_64')).toBe('alt')
      expect(getShortcutModifier('')).toBe('alt')
    })
  })

  describe('getShortcutDigit', () => {
    it('reads top-row and numpad digits with Alt', () => {
      expect(getShortcutDigit(key('Digit1'), 'alt')).toBe(1)
      expect(getShortcutDigit(key('Numpad6'), 'alt')).toBe(6)
    })

    it('reads digits with Cmd on macOS', () => {
      const cmd = { altKey: false, metaKey: true }
      expect(getShortcutDigit(key('Digit1', cmd), 'meta')).toBe(1)
      expect(getShortcutDigit(key('Numpad6', cmd), 'meta')).toBe(6)
    })

    it('ignores the other platform modifier', () => {
      expect(getShortcutDigit(key('Digit1'), 'meta')).toBeUndefined()
      expect(getShortcutDigit(key('Digit1', { altKey: false, metaKey: true }), 'alt')).toBeUndefined()
      expect(getShortcutDigit(key('Digit1', { metaKey: true }), 'meta')).toBeUndefined()
    })

    it('ignores other chords and keys', () => {
      expect(getShortcutDigit(key('Digit1', { altKey: false }), 'alt')).toBeUndefined()
      expect(getShortcutDigit(key('Digit1', { ctrlKey: true }), 'alt')).toBeUndefined()
      expect(getShortcutDigit(key('Digit1', { metaKey: true }), 'alt')).toBeUndefined()
      expect(getShortcutDigit(key('Digit1', { shiftKey: true }), 'alt')).toBeUndefined()
      expect(getShortcutDigit(key('KeyA'), 'alt')).toBeUndefined()
    })
  })

  describe('getPlacementElementForShortcut', () => {
    it('maps the ladder shortcuts', () => {
      expect(getPlacementElementForShortcut('ld', key('Digit1'), 'alt')?.id).toBe('contact')
      expect(getPlacementElementForShortcut('ld', key('Digit2'), 'alt')?.id).toBe('coil')
      expect(getPlacementElementForShortcut('ld', key('Digit3'), 'alt')?.id).toBe('block')
      expect(getPlacementElementForShortcut('ld', key('Digit4'), 'alt')).toBeUndefined()
    })

    it('maps the FBD shortcuts', () => {
      expect(getPlacementElementForShortcut('fbd', key('Digit1'), 'alt')?.id).toBe('input-variable')
      expect(getPlacementElementForShortcut('fbd', key('Digit2'), 'alt')?.id).toBe('output-variable')
      expect(getPlacementElementForShortcut('fbd', key('Digit3'), 'alt')?.id).toBe('block')
      expect(getPlacementElementForShortcut('fbd', key('Digit4'), 'alt')?.id).toBe('connector')
      expect(getPlacementElementForShortcut('fbd', key('Digit5'), 'alt')?.id).toBe('continuation')
      expect(getPlacementElementForShortcut('fbd', key('Digit6'), 'alt')?.id).toBe('comment')
      expect(getPlacementElementForShortcut('fbd', key('Digit7'), 'alt')).toBeUndefined()
    })

    it('maps Cmd + digit on macOS', () => {
      const cmd = { altKey: false, metaKey: true }
      expect(getPlacementElementForShortcut('ld', key('Digit2', cmd), 'meta')?.id).toBe('coil')
      expect(getPlacementElementForShortcut('ld', key('Digit2'), 'meta')).toBeUndefined()
    })

    it('ignores keys that are not a shortcut chord', () => {
      expect(getPlacementElementForShortcut('ld', key('KeyC'), 'alt')).toBeUndefined()
    })
  })

  it('formats the shortcut label for the platform modifier', () => {
    expect(formatPlacementShortcut(LADDER_PLACEMENT_ELEMENTS[0], 'alt')).toBe('Alt + 1')
    expect(formatPlacementShortcut(LADDER_PLACEMENT_ELEMENTS[0], 'meta')).toBe('Cmd + 1')
  })

  describe('isShortcutAllowedFromTarget', () => {
    const input = document.createElement('input')
    const div = document.createElement('div')

    it('allows top-row digits everywhere, text fields included', () => {
      expect(isShortcutAllowedFromTarget({ code: 'Digit1', target: input }, 'alt')).toBe(true)
      expect(isShortcutAllowedFromTarget({ code: 'Digit1', target: div }, 'alt')).toBe(true)
    })

    it('leaves Alt + numpad digits to text fields', () => {
      expect(isShortcutAllowedFromTarget({ code: 'Numpad1', target: input }, 'alt')).toBe(false)
      expect(isShortcutAllowedFromTarget({ code: 'Numpad1', target: div }, 'alt')).toBe(true)
    })

    it('allows Cmd + numpad digits in text fields', () => {
      expect(isShortcutAllowedFromTarget({ code: 'Numpad1', target: input }, 'meta')).toBe(true)
    })
  })

  describe('isEditableEventTarget', () => {
    it('detects text fields', () => {
      expect(isEditableEventTarget(document.createElement('input'))).toBe(true)
      expect(isEditableEventTarget(document.createElement('textarea'))).toBe(true)
      expect(isEditableEventTarget(document.createElement('select'))).toBe(true)
    })

    it('detects content-editable elements', () => {
      const div = document.createElement('div')
      Object.defineProperty(div, 'isContentEditable', { value: true })
      expect(isEditableEventTarget(div)).toBe(true)
    })

    it('ignores everything else', () => {
      expect(isEditableEventTarget(document.createElement('div'))).toBe(false)
      expect(isEditableEventTarget(null)).toBe(false)
      expect(isEditableEventTarget(window)).toBe(false)
    })
  })
})
