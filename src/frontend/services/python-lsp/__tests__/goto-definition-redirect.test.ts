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

describe('redirectPythonDefinitionToStore', () => {
  beforeEach(() => {
    setProjectPous([makePythonPou(POU_NAME)])
    // body-offsets is a module-level Map; reset between tests so
    // a prior test's `setBodyLineOffset(8)` can't leak into a test
    // that wants a fresh URI with no offset registered.
    __clearBodyLineOffsetsForTests()
  })

  it('returns false for a target URI different from the source', () => {
    // Typeshed stubs and external imports go through the URI-
    // reachability filter that lives in python-lsp/index.ts, not
    // this redirect.  Hand them back unchanged.
    const handled = redirectPythonDefinitionToStore(
      {
        uri: 'file:///typeshed/stdlib/builtins.pyi',
        range: { start: { line: 100, character: 0 }, end: { line: 100, character: 5 } },
      },
      { sourceUri: SOURCE_URI, sourcePouName: POU_NAME },
    )
    expect(handled).toBe(false)
  })

  it('routes a preamble-line target to the variables panel (cursor tagged for variables)', () => {
    // Preamble of 8 lines (matches what `synthesizeVariablesText`
    // produces for a 2-variable POU).  Target at LSP line 5 is
    // inside the preamble — should land in the variables-code-editor.
    setBodyLineOffset(SOURCE_URI, 8)

    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 5, character: 0 }, end: { line: 5, character: 10 } },
      },
      { sourceUri: SOURCE_URI, sourcePouName: POU_NAME },
    )
    expect(handled).toBe(true)

    const editor = openPLCStoreBase.getState().editor
    expect(editor.type).toBe('plc-textual')
    if (editor.type === 'plc-textual') {
      expect(editor.variable.display).toBe('code')
      expect(editor.cursorPosition).toEqual({
        lineNumber: 6, // LSP line 5 + 1 (0-indexed → 1-indexed Monaco)
        column: 1, // character 0 + 1
        offset: 0,
        target: 'variables',
      })
    }
  })

  it('routes a body-line target to the body editor with the body offset subtracted', () => {
    setBodyLineOffset(SOURCE_URI, 8)

    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 15, character: 4 }, end: { line: 15, character: 14 } },
      },
      { sourceUri: SOURCE_URI, sourcePouName: POU_NAME },
    )
    expect(handled).toBe(true)

    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      // Variables panel stays in table mode (no toggle for body targets)
      expect(editor.variable.display).toBe('table')
      expect(editor.cursorPosition).toEqual({
        lineNumber: 8, // 15 - 8 + 1
        column: 5, // 4 + 1
        offset: 0,
        target: 'body',
      })
    }
  })

  it('treats line 0 (no preamble registered) as a body target', () => {
    // bodyLineOffset defaults to 0 when the URI is unknown — every
    // line counts as "body", which matches what we want for a POU
    // we haven't yet `attachPou`d.  The redirect still opens the
    // tab and places the cursor at line 1.
    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      },
      { sourceUri: SOURCE_URI, sourcePouName: POU_NAME },
    )
    expect(handled).toBe(true)
    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      expect(editor.cursorPosition?.target).toBe('body')
    }
  })

  it('returns false when the POU named in the context is missing', () => {
    setProjectPous([])
    const handled = redirectPythonDefinitionToStore(
      {
        uri: SOURCE_URI,
        range: { start: { line: 12, character: 0 }, end: { line: 12, character: 5 } },
      },
      { sourceUri: SOURCE_URI, sourcePouName: POU_NAME },
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
      { sourceUri: SOURCE_URI, sourcePouName: POU_NAME },
    )
    expect(handled).toBe(true)
    const editor = openPLCStoreBase.getState().editor
    if (editor.type === 'plc-textual') {
      expect(editor.cursorPosition?.lineNumber).toBe(6) // line 5 + 1
    }
  })
})
