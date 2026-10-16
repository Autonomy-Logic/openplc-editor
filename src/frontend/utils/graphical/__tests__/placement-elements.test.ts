import {
  FBD_PLACEMENT_ELEMENTS,
  findPlacementElement,
  formatPlacementShortcut,
  getAltDigit,
  getPlacementElementForShortcut,
  getPlacementElements,
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
    expect(findPlacementElement('fbd', 'comment')?.label).toBe('Comment')
    expect(findPlacementElement('ld', 'comment')).toBeUndefined()
  })

  describe('getAltDigit', () => {
    it('reads top-row and numpad digits', () => {
      expect(getAltDigit(key('Digit1'))).toBe(1)
      expect(getAltDigit(key('Numpad6'))).toBe(6)
    })

    it('ignores other chords and keys', () => {
      expect(getAltDigit(key('Digit1', { altKey: false }))).toBeUndefined()
      expect(getAltDigit(key('Digit1', { ctrlKey: true }))).toBeUndefined()
      expect(getAltDigit(key('Digit1', { metaKey: true }))).toBeUndefined()
      expect(getAltDigit(key('Digit1', { shiftKey: true }))).toBeUndefined()
      expect(getAltDigit(key('KeyA'))).toBeUndefined()
    })
  })

  describe('getPlacementElementForShortcut', () => {
    it('maps the ladder shortcuts', () => {
      expect(getPlacementElementForShortcut('ld', key('Digit1'))?.id).toBe('contact')
      expect(getPlacementElementForShortcut('ld', key('Digit2'))?.id).toBe('coil')
      expect(getPlacementElementForShortcut('ld', key('Digit3'))?.id).toBe('block')
      expect(getPlacementElementForShortcut('ld', key('Digit4'))).toBeUndefined()
    })

    it('maps the FBD shortcuts', () => {
      expect(getPlacementElementForShortcut('fbd', key('Digit1'))?.id).toBe('input-variable')
      expect(getPlacementElementForShortcut('fbd', key('Digit2'))?.id).toBe('output-variable')
      expect(getPlacementElementForShortcut('fbd', key('Digit3'))?.id).toBe('block')
      expect(getPlacementElementForShortcut('fbd', key('Digit4'))?.id).toBe('connector')
      expect(getPlacementElementForShortcut('fbd', key('Digit5'))?.id).toBe('continuation')
      expect(getPlacementElementForShortcut('fbd', key('Digit6'))?.id).toBe('comment')
      expect(getPlacementElementForShortcut('fbd', key('Digit7'))).toBeUndefined()
    })

    it('ignores keys that are not an Alt + digit chord', () => {
      expect(getPlacementElementForShortcut('ld', key('KeyC'))).toBeUndefined()
    })
  })

  it('formats the shortcut label', () => {
    expect(formatPlacementShortcut(LADDER_PLACEMENT_ELEMENTS[0])).toBe('Alt + 1')
  })

  describe('isShortcutAllowedFromTarget', () => {
    const input = document.createElement('input')
    const div = document.createElement('div')

    it('allows top-row digits everywhere, text fields included', () => {
      expect(isShortcutAllowedFromTarget({ code: 'Digit1', target: input })).toBe(true)
      expect(isShortcutAllowedFromTarget({ code: 'Digit1', target: div })).toBe(true)
    })

    it('leaves numpad digits to text fields', () => {
      expect(isShortcutAllowedFromTarget({ code: 'Numpad1', target: input })).toBe(false)
      expect(isShortcutAllowedFromTarget({ code: 'Numpad1', target: div })).toBe(true)
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
