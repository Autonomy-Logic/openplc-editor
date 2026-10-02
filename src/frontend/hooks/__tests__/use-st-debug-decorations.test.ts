/**
 * The badge scanner, driven through a stand-in Monaco model.
 *
 * What matters is which span of which line each badge lands on, so every
 * assertion reads the decorations the hook hands to Monaco rather than
 * anything rendered.
 */

import { renderHook } from '@testing-library/react'
import type * as monaco from 'monaco-editor'
import type { RefObject } from 'react'

import { useStDebugDecorations } from '../use-st-debug-decorations'

let boolValues = new Map<string, string>()
let nonBoolValues = new Map<string, string>()

jest.mock('../use-debug-value', () => ({
  useDebugBoolValuesMap: () => boolValues,
  useDebugNonBoolValuesMap: () => nonBoolValues,
}))

type Badge = { line: number; startCol: number; endCol: number; content: string }

const clear = jest.fn()

/** Enough of Monaco for the hook: a model it can read and a Range it can build. */
function harness(text: string, uri = 'inmemory://model/1') {
  const lines = text.split('\n')
  const collections: Badge[][] = []

  const editor = {
    getModel: () => ({
      uri: { toString: () => uri },
      getLineCount: () => lines.length,
      getLineContent: (n: number) => lines[n - 1],
    }),
    createDecorationsCollection: (decorations: monaco.editor.IModelDeltaDecoration[]) => {
      collections.push(
        decorations.map((d) => ({
          line: d.range.startLineNumber,
          startCol: d.range.startColumn,
          endCol: d.range.endColumn,
          content: String(d.options.after?.content ?? ''),
        })),
      )
      return { clear }
    },
  }

  const monacoInstance = {
    Range: class {
      constructor(
        public startLineNumber: number,
        public startColumn: number,
        public endLineNumber: number,
        public endColumn: number,
      ) {}
    },
  }

  return {
    collections,
    editorRef: { current: editor } as unknown as RefObject<monaco.editor.IStandaloneCodeEditor | null>,
    monacoRef: { current: monacoInstance } as unknown as RefObject<typeof monaco | null>,
  }
}

const render = (text: string, overrides: Partial<Parameters<typeof useStDebugDecorations>[0]> = {}, uri?: string) => {
  const h = harness(text, uri)
  const result = renderHook(() =>
    useStDebugDecorations({
      editorRef: h.editorRef,
      monacoRef: h.monacoRef,
      prefix: 'Prog:',
      enabled: true,
      modelVersion: text,
      ...overrides,
    }),
  )
  return { ...h, ...result, badges: h.collections[0] ?? [] }
}

beforeEach(() => {
  boolValues = new Map()
  nonBoolValues = new Map()
  clear.mockClear()
})

describe('useStDebugDecorations', () => {
  it('badges a live variable where it appears', () => {
    nonBoolValues = new Map([['Prog:speed', '42']])
    const { badges } = render('speed := 1;')

    expect(badges).toEqual([{ line: 1, startCol: 1, endCol: 6, content: ' = 42 ' }])
  })

  it('reads BOOL and non-BOOL values from their separate maps', () => {
    boolValues = new Map([['Prog:running', 'TRUE']])
    nonBoolValues = new Map([['Prog:speed', '42']])
    const { badges } = render('running := TRUE;\nspeed := 1;')

    expect(badges.map((b) => b.content)).toEqual([' = TRUE ', ' = 42 '])
  })

  it('badges only the first occurrence on a line', () => {
    nonBoolValues = new Map([['Prog:speed', '42']])
    const { badges } = render('speed := speed + 1;')

    expect(badges).toHaveLength(1)
    expect(badges[0].startCol).toBe(1)
  })

  it('matches case-insensitively, as IEC identifiers are', () => {
    nonBoolValues = new Map([['Prog:speed', '42']])
    expect(render('SPEED := 1;').badges).toHaveLength(1)
  })

  it('does not badge a name that is only part of a longer identifier', () => {
    nonBoolValues = new Map([['Prog:motor', '1']])
    expect(render('motorSpeed := 1;').badges).toEqual([])
  })

  it('gives an overlapping span to the longer name', () => {
    nonBoolValues = new Map([
      ['Prog:motor', '1'],
      ['Prog:motor.speed', '42'],
    ])
    const { badges } = render('motor.speed := 1;')

    expect(badges).toEqual([{ line: 1, startCol: 1, endCol: 12, content: ' = 42 ' }])
  })

  it('shows ? when the name is live but carries no value', () => {
    nonBoolValues = new Map([['Prog:speed', undefined as unknown as string]])
    expect(render('speed := 1;').badges[0].content).toBe(' = ? ')
  })

  it('ignores names that belong to another prefix', () => {
    nonBoolValues = new Map([['Other:speed', '42']])
    expect(render('speed := 1;').badges).toEqual([])
  })

  it('clears its decorations on unmount', () => {
    nonBoolValues = new Map([['Prog:speed', '42']])
    render('speed := 1;').unmount()

    expect(clear).toHaveBeenCalled()
  })
})

describe('comments are not scanned', () => {
  beforeEach(() => {
    nonBoolValues = new Map([['Prog:speed', '42']])
  })

  it('skips a line comment', () => {
    expect(render('// speed is set below').badges).toEqual([])
  })

  it('skips a (* *) block, including the lines between', () => {
    expect(render('(* speed\nspeed\nspeed *)').badges).toEqual([])
  })

  it('skips a /* */ block', () => {
    expect(render('/* speed */').badges).toEqual([])
  })

  it('resumes badging after a block comment closes', () => {
    const { badges } = render('(* speed *)\nspeed := 1;')

    expect(badges).toEqual([{ line: 2, startCol: 1, endCol: 6, content: ' = 42 ' }])
  })

  it('keeps columns aligned when a comment precedes the name on the same line', () => {
    expect(render('(* x *) speed := 1;').badges[0].startCol).toBe(9)
  })
})

describe('the gates that switch it off', () => {
  beforeEach(() => {
    nonBoolValues = new Map([['Prog:speed', '42']])
  })

  it('does nothing when disabled', () => {
    expect(render('speed := 1;', { enabled: false }).collections).toEqual([])
  })

  it('does nothing without a prefix', () => {
    expect(render('speed := 1;', { prefix: undefined }).collections).toEqual([])
  })

  it('does nothing when no variable is live', () => {
    nonBoolValues = new Map()
    expect(render('speed := 1;').collections).toEqual([])
  })

  it('does nothing when the model is not the one the caller expects', () => {
    const off = render('speed := 1;', { expectedUri: 'inmemory://model/other' })
    expect(off.collections).toEqual([])
  })

  it('decorates when the expected model URI matches', () => {
    const on = render('speed := 1;', { expectedUri: 'inmemory://model/2' }, 'inmemory://model/2')
    expect(on.badges).toHaveLength(1)
  })
})
