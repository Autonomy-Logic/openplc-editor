/**
 * @jest-environment jsdom
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { normaliseLocation, routeToPou, routeToPouBody, routeToPouPreamble } from '../definition-redirect'

function makeStPou(name: string): PLCPou {
  return {
    name,
    pouType: 'program',
    interface: { variables: [] },
    body: { language: 'st', value: 'x := 1;' },
    documentation: '',
  } as PLCPou
}

function makePythonPou(name: string): PLCPou {
  return {
    name,
    pouType: 'function-block',
    interface: { variables: [] },
    body: { language: 'python', value: 'pass' },
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

describe('normaliseLocation', () => {
  it('flattens a plain Location', () => {
    const target = normaliseLocation({
      uri: 'pou://Main.st',
      range: { start: { line: 7, character: 3 }, end: { line: 7, character: 11 } },
    })
    expect(target).toEqual({ uri: 'pou://Main.st', lineLsp: 7, characterLsp: 3 })
  })

  it('prefers selectionRange over targetRange on a LocationLink', () => {
    const target = normaliseLocation({
      targetUri: 'pou://Main.st',
      targetRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
      targetSelectionRange: { start: { line: 2, character: 4 }, end: { line: 2, character: 9 } },
    })
    expect(target).toEqual({ uri: 'pou://Main.st', lineLsp: 2, characterLsp: 4 })
  })

  it('falls back to targetRange when no selectionRange is provided', () => {
    // The LSP spec marks `targetSelectionRange` required on
    // LocationLink but servers (and our codepath) tolerate it
    // being absent; cast through `unknown` to mirror real
    // pyright responses without fighting the type checker.
    const target = normaliseLocation({
      targetUri: 'pou://Main.st',
      targetRange: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
    } as unknown as Parameters<typeof normaliseLocation>[0])
    expect(target).toEqual({ uri: 'pou://Main.st', lineLsp: 1, characterLsp: 0 })
  })
})

describe('routeToPou', () => {
  it('returns false when the POU is not in the project', () => {
    setProjectPous([])
    expect(routeToPou('Ghost')).toBe(false)
  })

  it('opens the POU tab and marks it selected when the POU exists', () => {
    setProjectPous([makeStPou('Main')])
    expect(routeToPou('Main')).toBe(true)
    expect(openPLCStoreBase.getState().selectedTab).toBe('Main')
    expect(openPLCStoreBase.getState().editor.meta.name).toBe('Main')
  })

  it('uses the POU body language so Python POUs get a textual tab too', () => {
    setProjectPous([makePythonPou('Block')])
    expect(routeToPou('Block')).toBe(true)
    const editor = openPLCStoreBase.getState().editor
    expect(editor.type).toBe('plc-textual')
    if (editor.type === 'plc-textual') {
      expect(editor.meta.language).toBe('python')
    }
  })
})

describe('routeToPouPreamble', () => {
  beforeEach(() => {
    setProjectPous([makeStPou('Main')])
  })

  it('returns false when the POU is missing', () => {
    setProjectPous([])
    expect(routeToPouPreamble('Ghost', 1, 1)).toBe(false)
  })

  it('switches the variables panel to code mode and tags the cursor for variables', () => {
    routeToPouPreamble('Main', 3, 7)
    const editor = openPLCStoreBase.getState().editor
    expect(editor.type).toBe('plc-textual')
    if (editor.type === 'plc-textual') {
      expect(editor.variable.display).toBe('code')
      expect(editor.cursorPosition).toEqual({
        lineNumber: 3,
        column: 7,
        offset: 0,
        target: 'variables',
      })
    }
  })

  it('clamps non-positive coordinates to a safe minimum so Monaco never sees line 0', () => {
    routeToPouPreamble('Main', 0, -1)
    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      expect(editor.cursorPosition).toEqual({
        lineNumber: 1,
        column: 1,
        offset: 0,
        target: 'variables',
      })
    }
  })
})

describe('routeToPouBody', () => {
  beforeEach(() => {
    setProjectPous([makeStPou('Main')])
  })

  it('returns false when the POU is missing', () => {
    setProjectPous([])
    expect(routeToPouBody('Ghost', 1, 1)).toBe(false)
  })

  it('places the cursor in the body with the body target tag', () => {
    routeToPouBody('Main', 12, 5)
    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      expect(editor.cursorPosition).toEqual({
        lineNumber: 12,
        column: 5,
        offset: 0,
        target: 'body',
      })
    }
  })

  it('leaves the variables panel in table mode (no display toggle)', () => {
    routeToPouBody('Main', 12, 5)
    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      expect(editor.variable.display).toBe('table')
    }
  })
})
