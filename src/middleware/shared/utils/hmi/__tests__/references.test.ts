import { defaultHmiSettings } from '../settings'
import {
  findHmiReferences,
  HMI_SETTINGS_ELEMENT,
  maskStComments,
  renameBlockHeader,
  renameHmiReferences,
} from '../references'
import type { ProjectHmi } from '../project-files'

const hmi = (): ProjectHmi => ({
  screens: [
    {
      name: 'Main',
      source:
        "FUNCTION_BLOCK Main EXTENDS HmiScreen\n  VAR b : Badge; c : ARRAY[0..1] OF Badge; p : POINTER TO Badge; s : STRING := 'Badge'; END_VAR\n  // Badge\n  HMI_Show(HMI_SCREEN # Details);\nEND_FUNCTION_BLOCK\n",
    },
    {
      name: 'Details',
      source: 'FUNCTION_BLOCK Details EXTENDS HmiScreen\n  (* HMI_SCREEN#Details *)\nEND_FUNCTION_BLOCK\n',
    },
  ],
  widgets: [
    { name: 'Badge', source: 'FUNCTION_BLOCK Badge EXTENDS HmiLamp END_FUNCTION_BLOCK' },
    { name: 'BigBadge', source: 'FUNCTION_BLOCK BigBadge EXTENDS Badge END_FUNCTION_BLOCK' },
  ],
  settings: {
    ...defaultHmiSettings(),
    startScreen: 'details',
    roles: { DETAILS: { engineer: true, operator: true, viewer: true } },
  },
})

describe('HMI references', () => {
  it('blanks comments and string literals, keeping offsets and lines', () => {
    const source = "a (* x\ny *) b // c\n'd$'e' \"f\" g"
    const masked = maskStComments(source)
    expect(masked).toHaveLength(source.length)
    expect(masked.split('\n')).toHaveLength(3)
    expect(masked.replace(/\s+/g, ' ').trim()).toBe('a b g')
  })

  it('finds a widget block where it is used as a type, outside comments and strings', () => {
    const impact = findHmiReferences('widget', 'Badge', hmi())
    expect(impact.references).toEqual([
      { element: 'Main', kind: 'screen', line: 2 },
      { element: 'Main', kind: 'screen', line: 2 },
      { element: 'Main', kind: 'screen', line: 2 },
      { element: 'BigBadge', kind: 'widget', line: 1 },
    ])
    expect(impact.byPou).toEqual(
      new Map([
        ['Main', 3],
        ['BigBadge', 1],
      ]),
    )
    expect(impact.byEditorType).toEqual(
      new Map([
        ['HMI screen', 3],
        ['HMI widget', 1],
      ]),
    )
  })

  it('finds navigation to a screen and its HMI Settings entries, but not its own file', () => {
    const impact = findHmiReferences('screen', 'Details', hmi())
    expect(impact.references).toEqual([
      { element: 'Main', kind: 'screen', line: 4 },
      { element: HMI_SETTINGS_ELEMENT, kind: 'settings' },
      { element: HMI_SETTINGS_ELEMENT, kind: 'settings' },
    ])
    expect(findHmiReferences('screen', 'Nowhere', undefined).totalReferences).toBe(0)
  })

  it('renames references and settings, and leaves the element itself to the caller', () => {
    const next = renameHmiReferences('screen', 'Details', 'Info', hmi())
    expect(next.screens[0].source).toContain('HMI_SCREEN # Info')
    expect(next.screens[1].source).toContain('(* HMI_SCREEN#Details *)')
    expect(next.settings.startScreen).toBe('Info')
    expect(Object.keys(next.settings.roles)).toEqual(['Info'])
    const widgets = renameHmiReferences('widget', 'Badge', 'Lamp2', hmi())
    expect(widgets.screens[0].source).toContain(
      "b : Lamp2; c : ARRAY[0..1] OF Lamp2; p : POINTER TO Lamp2; s : STRING := 'Badge'",
    )
    expect(widgets.widgets[1].source).toBe('FUNCTION_BLOCK BigBadge EXTENDS Lamp2 END_FUNCTION_BLOCK')
    expect(widgets.widgets[0].source).toBe(hmi().widgets[0].source)
  })

  it('leaves settings that did not validate untouched', () => {
    const raw = { ...hmi(), unparsedSettings: '{ bad' }
    expect(findHmiReferences('screen', 'Details', raw).references.some((r) => r.kind === 'settings')).toBe(false)
    expect(renameHmiReferences('screen', 'Details', 'Info', raw).settings).toEqual(raw.settings)
  })

  it('renames its own header, skipping one in a comment', () => {
    expect(renameBlockHeader('(* FUNCTION_BLOCK Old *)\nFUNCTION_BLOCK  old EXTENDS HmiScreen', 'Old', 'New')).toBe(
      '(* FUNCTION_BLOCK Old *)\nFUNCTION_BLOCK  New EXTENDS HmiScreen',
    )
    expect(renameBlockHeader('FUNCTION_BLOCK ABSTRACT Old', 'Old', 'New')).toBe('FUNCTION_BLOCK ABSTRACT New')
    expect(renameBlockHeader('PROGRAM Old', 'Old', 'New')).toBe('PROGRAM Old')
  })
})
