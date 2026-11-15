import { hmiBuildMarkers, type MarkedText } from '../build-markers'

const ERROR = 8

/** A text model over `text`, enough to place markers. */
function textModel(text: string): MarkedText {
  const lines = text.split('\n')
  return {
    getValue: () => text,
    getLineCount: () => lines.length,
    getLineContent: (n) => lines[n - 1],
    getLineMaxColumn: (n) => lines[n - 1].length + 1,
    getPositionAt: (offset) => {
      const before = text.slice(0, offset).split('\n')
      return { lineNumber: before.length, column: before[before.length - 1].length + 1 }
    },
  }
}

const SOURCE = 'FUNCTION_BLOCK Plant EXTENDS HmiScreen\n  VAR\n    S : WSTRING;\n  END_VAR\nEND_FUNCTION_BLOCK\n'
const at = (m: { startLineNumber: number; startColumn: number; endColumn: number }) =>
  SOURCE.split('\n')[m.startLineNumber - 1].slice(m.startColumn - 1, m.endColumn - 1)

describe('HMI build markers', () => {
  it('marks an error of this file at its line, past the indentation', () => {
    const [marker] = hmiBuildMarkers(
      textModel(SOURCE),
      'plant',
      [{ file: 'Plant', line: 3, message: 'S: WSTRING variables cannot be used on screens' }],
      [],
      ERROR,
    )
    expect(marker).toMatchObject({ severity: ERROR, startLineNumber: 3, message: expect.stringContaining('WSTRING') })
    expect(at(marker)).toBe('S : WSTRING;')
  })

  it('marks an error with no line, or of another file, at the block name with where it comes from', () => {
    const markers = hmiBuildMarkers(
      textModel(SOURCE),
      'Plant',
      [
        { file: 'HMI', message: 'the toolchain did not load' },
        { file: 'Other', line: 7, message: 'undefined type' },
      ],
      [],
      ERROR,
    )
    expect(markers.map((m) => [m.message, at(m)])).toEqual([
      ['HMI: the toolchain did not load', 'Plant'],
      ['Other:7: undefined type', 'Plant'],
    ])
  })

  it('leaves out an error the language service already marks on the same line', () => {
    const markers = hmiBuildMarkers(
      textModel(SOURCE),
      'Plant',
      [{ file: 'Plant', line: 3, message: "Undefined type 'WSTRINGX'" }],
      [{ startLineNumber: 3, message: "undefined type 'wstringx'" }],
      ERROR,
    )
    expect(markers).toEqual([])
  })
})
