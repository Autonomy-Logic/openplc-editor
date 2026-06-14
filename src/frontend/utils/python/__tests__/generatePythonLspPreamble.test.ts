// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Autonomy / OpenPLC Project
import type { PLCVariable } from '../../../../middleware/shared/ports/types'
import { generatePythonLspPreamble } from '../generatePythonLspPreamble'

const makeScalar = (
  name: string,
  cls: PLCVariable['class'],
  baseType: string,
  initialValue: string | null = null,
): PLCVariable => ({
  name,
  class: cls,
  type: { definition: 'base-type', value: baseType },
  location: '',
  initialValue,
  documentation: '',
  debug: false,
})

const makeArray = (name: string, cls: PLCVariable['class'], innerType: string, dimension: string): PLCVariable => ({
  name,
  class: cls,
  type: {
    definition: 'array',
    value: `ARRAY [${dimension}] OF ${innerType}`,
    data: {
      baseType: { definition: 'base-type', value: innerType },
      dimensions: [{ dimension }],
    },
  },
  location: '',
  documentation: '',
  debug: false,
})

describe('generatePythonLspPreamble', () => {
  describe('empty cases', () => {
    it('returns empty text for an empty variables array', () => {
      const result = generatePythonLspPreamble([])
      expect(result.text).toBe('')
      expect(result.lineCount).toBe(0)
    })

    it('returns empty text when no variables are input/output class', () => {
      // The runtime injection only wires `input` and `output` through
      // shared memory.  Local / temp / external would never become
      // runtime globals — preamble must skip them so the LSP doesn't
      // pretend they exist.
      const vars = [
        makeScalar('localOnly', 'local', 'INT'),
        makeScalar('tempOnly', 'temp', 'BOOL'),
        makeScalar('externOnly', 'external', 'REAL'),
        makeScalar('ioOnly', 'inOut', 'INT'),
      ]
      const result = generatePythonLspPreamble(vars)
      expect(result.text).toBe('')
      expect(result.lineCount).toBe(0)
    })

    it('returns empty text when every variable has an unmappable type (e.g. TIME)', () => {
      // TIME / DATE / TOD / DT aren't wired through `injectPython-
      // Runtime` yet; the mapper returns null for them so the
      // preamble skips them.  If all inputs/outputs are unmappable,
      // there's nothing to declare.
      const vars = [makeScalar('then', 'input', 'TIME'), makeScalar('today', 'output', 'DATE')]
      const result = generatePythonLspPreamble(vars)
      expect(result.text).toBe('')
      expect(result.lineCount).toBe(0)
    })
  })

  describe('scalar type mapping', () => {
    const cases: Array<[string, string, string]> = [
      // [IEC type, Python annotation, default literal]
      ['BOOL', 'bool', 'False'],
      ['SINT', 'int', '0'],
      ['INT', 'int', '0'],
      ['DINT', 'int', '0'],
      ['LINT', 'int', '0'],
      ['USINT', 'int', '0'],
      ['UINT', 'int', '0'],
      ['UDINT', 'int', '0'],
      ['ULINT', 'int', '0'],
      ['BYTE', 'int', '0'],
      ['WORD', 'int', '0'],
      ['DWORD', 'int', '0'],
      ['LWORD', 'int', '0'],
      ['REAL', 'float', '0.0'],
      ['LREAL', 'float', '0.0'],
      ['STRING', 'str', "''"],
      ['WSTRING', 'str', "''"],
    ]
    it.each(cases)('maps IEC %s → Python %s with default %s', (iec, py, def) => {
      const vars = [makeScalar('x', 'input', iec)]
      const result = generatePythonLspPreamble(vars)
      expect(result.text).toContain(`x: ${py} = ${def}`)
    })

    it('accepts mixed casing on the IEC type name', () => {
      // Generators upstream sometimes hand us lowercase ('string', 'int');
      // the mapper normalises so the LSP doesn't trip on cosmetic case.
      const vars = [makeScalar('lc', 'input', 'string'), makeScalar('mc', 'output', 'Int')]
      const result = generatePythonLspPreamble(vars)
      expect(result.text).toContain(`lc: str = ''`)
      expect(result.text).toContain('mc: int = 0')
    })
  })

  describe('array handling', () => {
    it('declares an array as list[T] sized to the IEC dimension', () => {
      const result = generatePythonLspPreamble([makeArray('buf', 'input', 'INT', '1..10')])
      expect(result.text).toContain('buf: list[int] = [0] * 10')
    })

    it('uses the inner type default for the multiplier literal', () => {
      const result = generatePythonLspPreamble([makeArray('flags', 'output', 'BOOL', '1..4')])
      expect(result.text).toContain('flags: list[bool] = [False] * 4')
    })

    it('skips an array whose inner type is unmappable', () => {
      // ARRAY OF TIME — inner type can't render, drop the whole entry
      // rather than emitting a half-typed declaration the runtime
      // wouldn't honour either.
      const result = generatePythonLspPreamble([makeArray('times', 'input', 'TIME', '1..3')])
      expect(result.text).toBe('')
    })

    it('falls back to an empty list when the array dimension is malformed', () => {
      // Defensive: if `getArrayTotalElements` returns 0 (bad
      // dimension), emit `[]` rather than `[default] * 0`, which is
      // also `[]` but reads more clearly.
      const bad = makeArray('x', 'output', 'INT', '')
      // Strip the dimension so the helper returns 0 elements
      bad.type.data!.dimensions = [{ dimension: '' }]
      const result = generatePythonLspPreamble([bad])
      expect(result.text).toContain('x: list[int] = []')
    })
  })

  describe('class filtering', () => {
    it('includes only input + output, excludes local / temp / inOut / external', () => {
      const vars = [
        makeScalar('inA', 'input', 'INT'),
        makeScalar('outB', 'output', 'REAL'),
        makeScalar('localC', 'local', 'BOOL'),
        makeScalar('tempD', 'temp', 'INT'),
        makeScalar('ioE', 'inOut', 'INT'),
        makeScalar('extF', 'external', 'INT'),
      ]
      const result = generatePythonLspPreamble(vars)
      expect(result.text).toContain('inA: int = 0')
      expect(result.text).toContain('outB: float = 0.0')
      expect(result.text).not.toContain('localC')
      expect(result.text).not.toContain('tempD')
      expect(result.text).not.toContain('ioE')
      expect(result.text).not.toContain('extF')
    })
  })

  describe('user-data-type handling', () => {
    it('skips user-data-type variables (structs / enums)', () => {
      // `injectPythonRuntime` doesn't pack these into shared memory
      // either; LSP stays in lockstep by not declaring them.
      const structVar: PLCVariable = {
        name: 'myStruct',
        class: 'input',
        type: { definition: 'user-data-type', value: 'MyStruct' },
        location: '',
        documentation: '',
        debug: false,
      }
      const result = generatePythonLspPreamble([structVar])
      expect(result.text).toBe('')
    })
  })

  describe('header + structure', () => {
    it('emits the auto-generated header comment when at least one var is declared', () => {
      const result = generatePythonLspPreamble([makeScalar('x', 'input', 'BOOL')])
      expect(result.text).toContain('# IEC variables — auto-generated for the Pyright language server.')
      expect(result.text).toContain('# Not part of the source file')
    })

    it('reports lineCount equal to the number of newline characters in `text`', () => {
      // lineCount is the offset the LSP integration applies when
      // mapping between Pyright's view (preamble + user code) and
      // the user's editor view (user code only).  The trailing `\n`
      // of the preamble merges with the user's first line on
      // concatenation, so lineCount must equal `text.split('\n')
      // .length - 1` — NOT `.length`, which would shift every
      // hover position to the line below the user's cursor.
      const result = generatePythonLspPreamble([
        makeScalar('a', 'input', 'INT'),
        makeScalar('b', 'output', 'BOOL'),
        makeArray('c', 'input', 'REAL', '1..2'),
      ])
      const newlineCount = (result.text.match(/\n/g) ?? []).length
      expect(result.lineCount).toBe(newlineCount)
    })

    it('places the user’s first line at augmented 0-indexed line `lineCount`', () => {
      // Explicit regression: the LSP wrapper sends
      // `preamble.text + userCode` to Pyright and offsets hover /
      // completion positions by `lineCount`.  Without this
      // invariant, hover info would describe the wrong variable.
      const result = generatePythonLspPreamble([makeScalar('x', 'input', 'BOOL')])
      const userFirstLine = 'first_user_line'
      const augmented = result.text + userFirstLine
      const lines = augmented.split('\n')
      expect(lines[result.lineCount]).toBe(userFirstLine)
    })

    it('ends with a blank separator so the user code begins on its own line', () => {
      // Pyright sees `<preamble><user-code>`; without the trailing
      // blank, the last declaration would butt against the user's
      // first source line and shift line numbering by one.  The blank
      // line keeps the offset clean.
      const result = generatePythonLspPreamble([makeScalar('x', 'input', 'INT')])
      expect(result.text.endsWith('\n\n')).toBe(true)
    })
  })

  describe('variableNameByPreambleLine', () => {
    it('is empty when no variables produce declaration lines', () => {
      expect(generatePythonLspPreamble([]).variableNameByPreambleLine.size).toBe(0)
      expect(generatePythonLspPreamble([makeScalar('x', 'local', 'BOOL')]).variableNameByPreambleLine.size).toBe(0)
    })

    it('maps each declaration line to the corresponding variable name in order', () => {
      const result = generatePythonLspPreamble([
        makeScalar('ValveState', 'input', 'BOOL'),
        makeScalar('DidPrint', 'output', 'BOOL'),
      ])
      // Header occupies lines 0-4; declarations start at line 5.
      expect(result.variableNameByPreambleLine.get(5)).toBe('ValveState')
      expect(result.variableNameByPreambleLine.get(6)).toBe('DidPrint')
      expect(result.variableNameByPreambleLine.size).toBe(2)
    })

    it('skips variables whose type doesn’t map to a Python annotation (e.g. TIME)', () => {
      const result = generatePythonLspPreamble([
        makeScalar('CycleStart', 'input', 'TIME'), // unsupported → no preamble line
        makeScalar('ValveState', 'input', 'BOOL'), // first emitted line
      ])
      expect(result.variableNameByPreambleLine.size).toBe(1)
      expect(result.variableNameByPreambleLine.get(5)).toBe('ValveState')
    })

    it('locks the mapping to the actual declaration text in the same preamble', () => {
      // Spot-check that the line number we record matches where the
      // variable name actually appears in `text` — guards against the
      // header line count drifting out of sync with the offset.
      const result = generatePythonLspPreamble([makeScalar('Flag', 'input', 'BOOL')])
      const lines = result.text.split('\n')
      for (const [line, name] of result.variableNameByPreambleLine) {
        expect(lines[line].startsWith(`${name}:`)).toBe(true)
      }
    })
  })
})
