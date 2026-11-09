// Domain tests: every rule is checked on plain data; documents are compared by value and by identity.
import {
  addVariable,
  EMPTY_VARIABLE_DOCUMENT,
  isConsistentDocument,
  isVariableType,
  removeVariable,
  renameVariable,
  type VariableDocument,
} from '..'

const document: VariableDocument = {
  variables: [
    { id: 1, name: 'Start', type: 'BOOL' },
    { id: 2, name: 'Speed', type: 'INT' },
  ],
  nextId: 3,
}

describe('addVariable', () => {
  it('appends a variable with the next id', () => {
    const result = addVariable(EMPTY_VARIABLE_DOCUMENT, 'Start', 'BOOL')
    expect(result).toEqual({ ok: true, document: { variables: [{ id: 1, name: 'Start', type: 'BOOL' }], nextId: 2 } })
  })

  it('rejects an invalid identifier', () => {
    expect(addVariable(document, '9lives', 'INT')).toEqual({
      ok: false,
      violation: { kind: 'invalid-name', name: '9lives', reason: 'invalid-format' },
    })
  })

  it('rejects a name already used, ignoring case', () => {
    expect(addVariable(document, 'START', 'BOOL')).toEqual({
      ok: false,
      violation: { kind: 'duplicate-name', name: 'START' },
    })
  })
})

describe('renameVariable', () => {
  it('renames only the target variable', () => {
    const result = renameVariable(document, 2, 'MotorSpeed')
    expect(result.ok && result.document.variables).toEqual([
      { id: 1, name: 'Start', type: 'BOOL' },
      { id: 2, name: 'MotorSpeed', type: 'INT' },
    ])
  })

  it('rejects renaming to another variable name', () => {
    expect(renameVariable(document, 2, 'start')).toEqual({
      ok: false,
      violation: { kind: 'duplicate-name', name: 'start' },
    })
  })

  it('allows changing only the case of its own name', () => {
    expect(renameVariable(document, 1, 'START').ok).toBe(true)
  })

  it('returns the same document when the name does not change', () => {
    expect(renameVariable(document, 1, 'Start')).toEqual({ ok: true, document })
    const result = renameVariable(document, 1, 'Start')
    expect(result.ok && result.document).toBe(document)
  })

  it('rejects an unknown id', () => {
    expect(renameVariable(document, 99, 'Other')).toEqual({
      ok: false,
      violation: { kind: 'unknown-variable', id: 99 },
    })
  })
})

describe('removeVariable', () => {
  it('removes the variable and keeps nextId', () => {
    expect(removeVariable(document, 1)).toEqual({
      ok: true,
      document: { variables: [{ id: 2, name: 'Speed', type: 'INT' }], nextId: 3 },
    })
  })

  it('rejects an unknown id', () => {
    expect(removeVariable(document, 5)).toEqual({ ok: false, violation: { kind: 'unknown-variable', id: 5 } })
  })
})

describe('isConsistentDocument', () => {
  it('accepts a valid document', () => {
    expect(isConsistentDocument(document)).toBe(true)
  })

  it.each<[string, VariableDocument]>([
    ['duplicate ids', { variables: [document.variables[0], { id: 1, name: 'Other', type: 'INT' }], nextId: 3 }],
    ['id not below nextId', { variables: [{ id: 3, name: 'Late', type: 'INT' }], nextId: 3 }],
    ['invalid name', { variables: [{ id: 1, name: 'bad name', type: 'INT' }], nextId: 2 }],
    [
      'duplicate names',
      {
        variables: [
          { id: 1, name: 'Same', type: 'INT' },
          { id: 2, name: 'SAME', type: 'INT' },
        ],
        nextId: 3,
      },
    ],
  ])('rejects %s', (_label, candidate) => {
    expect(isConsistentDocument(candidate)).toBe(false)
  })
})

describe('isVariableType', () => {
  it('narrows known IEC types only', () => {
    expect(isVariableType('REAL')).toBe(true)
    expect(isVariableType('real')).toBe(false)
    expect(isVariableType(1)).toBe(false)
  })
})
