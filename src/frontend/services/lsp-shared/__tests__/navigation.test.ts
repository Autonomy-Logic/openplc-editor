/**
 * @jest-environment jsdom
 */
import type * as monaco from 'monaco-editor'

import { __clearBodyLineOffsetsForTests, setBodyLineOffset } from '../body-offsets'
import { lspMirrorUri } from '../lsp-mirror'
import {
  attachOutlineActivation,
  bindOutlineTarget,
  navTargetForResource,
  OUTLINE_TARGET_COLUMN_BASE,
  outlineBindingFor,
  registerDefinitionOpener,
  resetOutlineTargets,
} from '../navigation'

const POU = 'inmemory://pou/main.st'
const JUMP = 'code.jump'

beforeEach(() => {
  __clearBodyLineOffsetsForTests()
  resetOutlineTargets(POU)
})

describe('navTargetForResource', () => {
  it('reads LSP coordinates straight off a mirror URI', () => {
    expect(navTargetForResource(lspMirrorUri(POU), { lineNumber: 3, column: 5 })).toEqual({
      uri: POU,
      lineLsp: 2,
      characterLsp: 4,
    })
  })

  it('shifts a body model line back by its document preamble', () => {
    setBodyLineOffset(POU, 5)
    expect(navTargetForResource(POU, { lineNumber: 2, column: 1 })).toEqual({ uri: POU, lineLsp: 6, characterLsp: 0 })
  })
})

describe('registerDefinitionOpener', () => {
  function makeMonacoStub() {
    let opener: monaco.editor.ICodeEditorOpener | undefined
    const api = {
      editor: {
        registerEditorOpener: (o: monaco.editor.ICodeEditorOpener) => {
          opener = o
          return { dispose: jest.fn() }
        },
      },
    } as unknown as typeof monaco
    const source = (modelUri: string) =>
      ({ getModel: () => ({ uri: { toString: () => modelUri } }) }) as unknown as monaco.editor.ICodeEditor
    const resource = (uri: string) => ({ toString: () => uri }) as unknown as monaco.Uri
    return { api, open: () => opener!, source, resource }
  }

  it('leaves a target inside the source model to Monaco', async () => {
    const navigate = jest.fn(() => true)
    const { api, open, source, resource } = makeMonacoStub()
    registerDefinitionOpener(api, navigate)

    expect(await open().openCodeEditor(source(POU), resource(POU), { lineNumber: 4, column: 1 })).toBe(false)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('navigates a mirror target with the range start as its position', async () => {
    const navigate = jest.fn(() => true)
    const { api, open, source, resource } = makeMonacoStub()
    registerDefinitionOpener(api, navigate)

    const range = { startLineNumber: 3, startColumn: 3, endLineNumber: 3, endColumn: 8 }
    expect(await open().openCodeEditor(source(POU), resource(lspMirrorUri(POU)), range)).toBe(true)
    expect(navigate).toHaveBeenCalledWith({ uri: POU, lineLsp: 2, characterLsp: 2 })
  })

  it('hands the request on when the navigator does not own the URI', async () => {
    const navigate = jest.fn(() => false)
    const { api, open, source, resource } = makeMonacoStub()
    registerDefinitionOpener(api, navigate)

    expect(await open().openCodeEditor(source(POU), resource('file:///other.py'))).toBe(false)
    expect(navigate).toHaveBeenCalledWith({ uri: 'file:///other.py', lineLsp: 0, characterLsp: 0 })
  })
})

describe('outline target binding', () => {
  const navigate = () => true

  it('hands out one column past the base per entry and finds it again', () => {
    const first = bindOutlineTarget(POU, 7, { uri: POU, lineLsp: 1, characterLsp: 2 }, navigate)
    const second = bindOutlineTarget(POU, 7, { uri: POU, lineLsp: 2, characterLsp: 2 }, navigate)

    expect(first).toEqual({
      startLineNumber: 7,
      startColumn: OUTLINE_TARGET_COLUMN_BASE,
      endLineNumber: 7,
      endColumn: OUTLINE_TARGET_COLUMN_BASE,
    })
    expect(second.startColumn).toBe(OUTLINE_TARGET_COLUMN_BASE + 1)
    expect(outlineBindingFor(POU, second)?.target).toEqual({ uri: POU, lineLsp: 2, characterLsp: 2 })
  })

  it('knows nothing about an ordinary range, and forgets bindings on reset', () => {
    const bound = bindOutlineTarget(POU, 1, { uri: POU, lineLsp: 1, characterLsp: 0 }, navigate)
    expect(outlineBindingFor(POU, { startLineNumber: 1, startColumn: 4, endLineNumber: 1, endColumn: 4 })).toBeNull()

    resetOutlineTargets(POU)
    expect(outlineBindingFor(POU, bound)).toBeNull()
  })
})

describe('attachOutlineActivation', () => {
  function makeEditor(modelUri: string) {
    const original = jest.fn()
    const editor = {
      getModel: () => ({ uri: { toString: () => modelUri } }),
      setSelection: original,
    } as unknown as monaco.editor.ICodeEditor
    return { editor, original }
  }

  function makeMonacoStub(existing: monaco.editor.ICodeEditor[]) {
    const created: Array<(e: monaco.editor.ICodeEditor) => void> = []
    const api = {
      editor: {
        getEditors: () => existing,
        onDidCreateEditor: (listener: (e: monaco.editor.ICodeEditor) => void) => {
          created.push(listener)
          return { dispose: jest.fn() }
        },
      },
    } as unknown as typeof monaco
    return { api, create: (e: monaco.editor.ICodeEditor) => created.forEach((l) => l(e)) }
  }

  it('navigates instead of selecting when Go to Symbol accepts a bound entry', () => {
    const navigate = jest.fn(() => true)
    const { editor, original } = makeEditor(POU)
    attachOutlineActivation(makeMonacoStub([editor]).api)
    const bound = bindOutlineTarget(POU, 3, { uri: POU, lineLsp: 2, characterLsp: 4 }, navigate)

    editor.setSelection(bound, JUMP)

    expect(navigate).toHaveBeenCalledWith({ uri: POU, lineLsp: 2, characterLsp: 4 })
    expect(original).not.toHaveBeenCalled()
  })

  it('selects as usual for an ordinary jump, a non-jump source, or a navigator that declines', () => {
    const { editor, original } = makeEditor(POU)
    attachOutlineActivation(makeMonacoStub([editor]).api)
    const plain = { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 }
    const declined = bindOutlineTarget(POU, 3, { uri: POU, lineLsp: 2, characterLsp: 0 }, () => false)

    editor.setSelection(plain, JUMP)
    editor.setSelection(declined, 'mouse')
    editor.setSelection(declined, JUMP)

    expect(original.mock.calls).toEqual([
      [plain, JUMP],
      [declined, 'mouse'],
      [declined, JUMP],
    ])
  })

  it('patches editors created later, once per Monaco namespace', () => {
    const navigate = jest.fn(() => true)
    const stub = makeMonacoStub([])
    attachOutlineActivation(stub.api)
    attachOutlineActivation(stub.api)
    const { editor, original } = makeEditor(POU)
    stub.create(editor)
    const bound = bindOutlineTarget(POU, 1, { uri: POU, lineLsp: 1, characterLsp: 0 }, navigate)

    editor.setSelection(bound, JUMP)

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(original).not.toHaveBeenCalled()
  })
})
