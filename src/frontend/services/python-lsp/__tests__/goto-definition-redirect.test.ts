/**
 * @jest-environment jsdom
 */
import type { PLCPou } from '../../../../middleware/shared/ports/types'
import { openPLCStoreBase } from '../../../store'
import { __clearBodyLineOffsetsForTests, setBodyLineOffset } from '../../lsp-shared/body-offsets'
import { redirectPythonDefinitionToStore } from '../goto-definition-redirect'

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
    project: { ...s.project, data: { ...s.project.data, pous, dataTypes: [] } },
    editor: { type: 'available', meta: { name: 'available' } },
    editors: [],
    tabs: [],
    selectedTab: null,
  }))
}

const SOURCE_URI = 'file:///workspace/MyPou.py'
const POU_NAME = 'MyPou'

/**
 * Build a redirect ctx that matches what the python-lsp service
 * would compute for two variables `ValveState (input, BOOL)` and
 * `DidPrint (output, BOOL)`:
 *
 *   Python preamble (5 header lines + 2 declarations):
 *     line 5 → ValveState
 *     line 6 → DidPrint
 *
 *   IEC VAR-block text (`generateIecVariablesToString` order):
 *     line 1: VAR_INPUT
 *     line 2:     ValveState : BOOL;   ← col 5
 *     line 3: END_VAR
 *     line 4: VAR_OUTPUT
 *     line 5:     DidPrint : BOOL;     ← col 5
 *     line 6: END_VAR
 */
function makeCtx(overrides: Partial<Parameters<typeof redirectPythonDefinitionToStore>[1]> = {}) {
  return {
    sourceUri: SOURCE_URI,
    sourcePouName: POU_NAME,
    variableNameByPreambleLine: new Map<number, string>([
      [5, 'ValveState'],
      [6, 'DidPrint'],
    ]),
    iecVariableLineMap: new Map<string, { line: number; column: number }>([
      ['ValveState', { line: 2, column: 5 }],
      ['DidPrint', { line: 5, column: 5 }],
    ]),
    ...overrides,
  }
}

describe('redirectPythonDefinitionToStore', () => {
  beforeEach(() => {
    setProjectPous([makePythonPou(POU_NAME)])
    // body-offsets is a module-level Map; reset between tests so
    // a prior test's `setBodyLineOffset(8)` can't leak.
    __clearBodyLineOffsetsForTests()
  })

  it('returns false for a target URI different from the source', () => {
    const handled = redirectPythonDefinitionToStore(
      {
        uri: 'file:///typeshed/stdlib/builtins.pyi',
        range: { start: { line: 100, character: 0 }, end: { line: 100, character: 5 } },
      },
      makeCtx(),
    )
    expect(handled).toBe(false)
  })

  it('routes a preamble target through preamble-line → variable name → IEC line', () => {
    // Preamble of 8 lines.  Target at LSP line 5 is `ValveState`
    // in our test fixture.  Should land at IEC line 2, col 5.
    setBodyLineOffset(SOURCE_URI, 8)

    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
      },
      makeCtx(),
    )
    expect(handled).toBe(true)

    const editor = openPLCStoreBase.getState().editor
    expect(editor.type).toBe('plc-textual')
    if (editor.type === 'plc-textual') {
      expect(editor.variable.display).toBe('code')
      expect(editor.cursorPosition).toEqual({
        lineNumber: 2, // IEC text line for ValveState
        column: 5, // start of the variable name (4-space indent + 1)
        offset: 0,
        target: 'variables',
      })
    }
  })

  it('lands the cursor on the matching IEC line for each declared variable', () => {
    setBodyLineOffset(SOURCE_URI, 8)

    // DidPrint sits at preamble line 6, IEC line 5.
    redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 6, character: 0 }, end: { line: 6, character: 8 } },
      },
      makeCtx(),
    )

    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      expect(editor.cursorPosition?.lineNumber).toBe(5)
    }
  })

  it('returns false when the preamble line has no variable mapped (defensive)', () => {
    // Header comment lines (preamble lines 0-4 in our fixture) have
    // no variable name in the map.  The redirect bails so the
    // URI-reachability fallback can suppress the navigation
    // cleanly.
    setBodyLineOffset(SOURCE_URI, 8)
    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 5 } },
      },
      makeCtx(),
    )
    expect(handled).toBe(false)
  })

  it('returns false when the variable name is missing from the IEC map (defensive)', () => {
    // Stale preamble that still names a variable the IEC map
    // doesn't know about.  Shouldn't happen in practice — both
    // maps are recomputed together — but if it ever did, the
    // redirect should bail rather than guess.
    setBodyLineOffset(SOURCE_URI, 8)
    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
      },
      makeCtx({
        iecVariableLineMap: new Map(), // empty
      }),
    )
    expect(handled).toBe(false)
  })

  it('routes a body target with the body offset subtracted', () => {
    setBodyLineOffset(SOURCE_URI, 8)
    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 15, character: 4 }, end: { line: 15, character: 14 } },
      },
      makeCtx(),
    )
    expect(handled).toBe(true)

    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      expect(editor.variable.display).toBe('table') // body targets don't switch the panel
      expect(editor.cursorPosition).toEqual({
        lineNumber: 8, // 15 - 8 + 1
        column: 5, // 4 + 1
        offset: 0,
        target: 'body',
      })
    }
  })

  it('treats line 0 (no body offset registered) as a body target', () => {
    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      },
      makeCtx(),
    )
    expect(handled).toBe(true)
    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      expect(editor.cursorPosition?.target).toBe('body')
    }
  })

  it('returns false when the POU named in the context is missing', () => {
    setProjectPous([])
    setBodyLineOffset(SOURCE_URI, 8)
    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
      },
      makeCtx(),
    )
    expect(handled).toBe(false)
  })

  it('honours LocationLink shapes (selectionRange preferred)', () => {
    setBodyLineOffset(SOURCE_URI, 8)
    const handled = redirectPythonDefinitionToStore(
      {
        targetUri: SOURCE_URI,
        targetRange: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
        targetSelectionRange: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
      },
      makeCtx(),
    )
    expect(handled).toBe(true)
    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      expect(editor.cursorPosition?.lineNumber).toBe(2) // ValveState's IEC line
    }
  })
})
