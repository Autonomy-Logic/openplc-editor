/**
 * @jest-environment jsdom
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { setBodyLineOffset } from '../../lsp-shared/body-offsets'
import { redirectDefinitionToStore } from '../goto-definition-redirect'

function makeStPou(name: string): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: [] },
    body: { language: 'st', value: 'x := 1;' },
    documentation: '',
  } as PLCPou
}

function makeFbPou(name: string): PLCPou {
  return {
    name,
    pouType: 'function-block',
    interface: { variables: [] },
    body: { language: 'st', value: 'x := 1;' },
    documentation: '',
  } as PLCPou
}

function setProjectPous(pous: PLCPou[]) {
  openPLCStoreBase.setState((s) => ({
    ...s,
    project: {
      ...s.project,
      data: {
        ...s.project.data,
        pous,
        dataTypes: [],
      },
    },
    editor: { type: 'available', meta: { name: 'available' } },
    editors: [],
    tabs: [],
    selectedTab: null,
  }))
}

describe('redirectDefinitionToStore', () => {
  beforeEach(() => {
    setProjectPous([])
  })

  it('returns false for datatypes URI when no data types exist in the project', () => {
    // Empty dataTypes → findDataTypeAtLine returns null → redirect
    // bails so Monaco can fall back (it'll still no-op, but at least
    // we're not claiming to have handled it).
    expect(
      redirectDefinitionToStore({
        uri: 'inmemory://datatypes/__project__.st',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      }),
    ).toBe(false)
  })

  it('returns false when the target POU does not exist in the project', () => {
    setProjectPous([])
    expect(
      redirectDefinitionToStore({
        uri: 'inmemory://pou/Ghost.st',
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
      }),
    ).toBe(false)
  })

  it('routes a preamble-line target to the variables panel (tagged for variables)', () => {
    setProjectPous([makeStPou('Main')])
    setBodyLineOffset('inmemory://pou/Main.st', 5)

    const handled = redirectDefinitionToStore({
      uri: 'inmemory://pou/Main.st',
      range: { start: { line: 2, character: 3 }, end: { line: 2, character: 10 } },
    })

    expect(handled).toBe(true)
    const state = openPLCStoreBase.getState()
    expect(state.editor.type).toBe('plc-textual')
    expect(state.editor.meta.name).toBe('Main')
    expect(state.editor.cursorPosition).toBeDefined()
    expect(state.editor.cursorPosition!.target).toBe('variables')
    // LSP line 2 (0-indexed) → vars Monaco line 2 (1-indexed)
    expect(state.editor.cursorPosition!.lineNumber).toBe(2)
    expect(state.editor.cursorPosition!.column).toBe(4)
  })

  it('forces the variables panel into code mode for preamble targets', () => {
    setProjectPous([makeStPou('Main')])
    setBodyLineOffset('inmemory://pou/Main.st', 5)

    redirectDefinitionToStore({
      uri: 'inmemory://pou/Main.st',
      range: { start: { line: 1, character: 0 }, end: { line: 1, character: 0 } },
    })

    const state = openPLCStoreBase.getState()
    expect(state.editor.type).toBe('plc-textual')
    if (state.editor.type === 'plc-textual') {
      expect(state.editor.variable.display).toBe('code')
    }
  })

  it('routes a body-line target to the body editor (tagged for body, shifted by offset)', () => {
    setProjectPous([makeStPou('Main')])
    setBodyLineOffset('inmemory://pou/Main.st', 5)

    redirectDefinitionToStore({
      uri: 'inmemory://pou/Main.st',
      range: { start: { line: 7, character: 2 }, end: { line: 7, character: 8 } },
    })

    const state = openPLCStoreBase.getState()
    expect(state.editor.cursorPosition).toBeDefined()
    expect(state.editor.cursorPosition!.target).toBe('body')
    // LSP line 7, offset 5 → body Monaco line 3 (1-indexed)
    expect(state.editor.cursorPosition!.lineNumber).toBe(3)
    expect(state.editor.cursorPosition!.column).toBe(3)
  })

  it('handles LocationLink (targetUri / targetSelectionRange) the same way as Location', () => {
    setProjectPous([makeStPou('Main')])
    setBodyLineOffset('inmemory://pou/Main.st', 4)

    const handled = redirectDefinitionToStore({
      targetUri: 'inmemory://pou/Main.st',
      targetRange: { start: { line: 6, character: 0 }, end: { line: 6, character: 10 } },
      targetSelectionRange: { start: { line: 6, character: 4 }, end: { line: 6, character: 6 } },
      originSelectionRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    })

    expect(handled).toBe(true)
    const state = openPLCStoreBase.getState()
    expect(state.editor.cursorPosition!.target).toBe('body')
    // Uses targetSelectionRange when both are present
    expect(state.editor.cursorPosition!.lineNumber).toBe(3) // 6 - 4 + 1
    expect(state.editor.cursorPosition!.column).toBe(5)
  })

  it('opens a function-block POU with the correct tab elementType', () => {
    setProjectPous([makeFbPou('TankFB')])
    setBodyLineOffset('inmemory://pou/TankFB.st', 5)

    redirectDefinitionToStore({
      uri: 'inmemory://pou/TankFB.st',
      range: { start: { line: 6, character: 0 }, end: { line: 6, character: 0 } },
    })

    const state = openPLCStoreBase.getState()
    expect(state.editor.type).toBe('plc-textual')
    expect(state.editor.meta.name).toBe('TankFB')
    // Tab opened
    expect(state.tabs.find((t) => t.name === 'TankFB')).toBeDefined()
  })

  it('opens the POU tab without forcing text mode when LSP points at the declaration line', () => {
    // Line 0 of any POU's synthesized doc is the `PROGRAM` /
    // `FUNCTION` / `FUNCTION_BLOCK` declaration — strucpp uses that
    // position when Go to Definition lands on the POU name itself
    // (e.g. clicking `Manual_Override` in `inst : Manual_Override;`).
    // The redirect must open the tab but leave the target POU's
    // variables panel in its default table mode and skip the cursor
    // jump.
    setProjectPous([makeStPou('Main')])
    setBodyLineOffset('inmemory://pou/Main.st', 5)

    const handled = redirectDefinitionToStore({
      uri: 'inmemory://pou/Main.st',
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    })

    expect(handled).toBe(true)
    const state = openPLCStoreBase.getState()
    expect(state.editor.meta.name).toBe('Main')
    // No cursorPosition set — declaration target doesn't carry a
    // useful caret location.
    expect(state.editor.cursorPosition).toBeUndefined()
    // Variables panel stays in its default table mode.
    if (state.editor.type === 'plc-textual') {
      expect(state.editor.variable.display).toBe('table')
    }
  })
})
