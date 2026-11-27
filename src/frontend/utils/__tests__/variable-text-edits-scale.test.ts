import type { PLCVariable } from '../../../middleware/shared/ports/types'
import { buildTypeContext } from '../generate-iec-string-to-variables'
import { parseVariableDeclarations } from '../PLC/variable-declarations'
import { applyVariablesToText } from '../variable-text-edits'

const context = buildTypeContext()
const COUNT = 8000

const text = `VAR\n${Array.from({ length: COUNT }, (_, index) => `  v${index} : BOOL AT %IX${Math.floor(index / 8)}.${index % 8};`).join('\n')}\nEND_VAR`

const modelOf = (source: string): PLCVariable[] => parseVariableDeclarations(source, context).variables

describe('applyVariablesToText on a large block', () => {
  it('renames and reorders among 8,000 declarations', () => {
    const variables = modelOf(text)
    const next = [...variables]
    next[10] = { ...next[10], name: 'renamed' }
    ;[next[100], next[101]] = [next[101], next[100]]

    const started = Date.now()
    const result = applyVariablesToText(text, next, context)
    const elapsed = Date.now() - started

    const lines = result.split('\n')
    expect({
      renamed: lines[11].trim(),
      swapped: [lines[101].trim(), lines[102].trim()],
      count: modelOf(result).length,
      fast: elapsed < 3000,
    }).toEqual({
      renamed: 'renamed : BOOL AT %IX1.2;',
      swapped: ['v101 : BOOL AT %IX12.5;', 'v100 : BOOL AT %IX12.4;'],
      count: COUNT,
      fast: true,
    })
  })
})
