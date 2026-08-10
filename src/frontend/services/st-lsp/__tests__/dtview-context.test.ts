/**
 * @jest-environment jsdom
 */
import type { Diagnostic } from 'vscode-languageserver-protocol'

import type { PLCDataType } from '../../../../middleware/shared/ports/types'
import { diagnosticsInSpan, dtViewLineOffset, dtViewSpan, dtViewWindow } from '../dtview-context'

const enumType = (name: string): PLCDataType => ({
  name,
  derivation: 'enumerated',
  values: [{ description: 'RED' }],
  initialValue: 'RED',
})

const structType = (name: string, fields: string[]): PLCDataType => ({
  name,
  derivation: 'structure',
  variable: fields.map((field) => ({
    name: field,
    type: { definition: 'base-type', value: 'INT' },
  })),
})

// Aggregate document, LSP (0-indexed) lines:
//   0  TYPE
//   1    Colors : (RED) := RED;
//   2    Motor : STRUCT
//   3      speed : INT;
//   4    END_STRUCT;
//   5  END_TYPE
const DATA_TYPES: PLCDataType[] = [enumType('Colors'), structType('Motor', ['speed'])]

const diagnosticAt = (line: number): Diagnostic => ({
  range: { start: { line, character: 0 }, end: { line, character: 4 } },
  message: `line ${line}`,
})

describe('dtViewSpan', () => {
  it('returns the entry span for a type in the document', () => {
    expect(dtViewSpan(DATA_TYPES, 'Motor')).toEqual({ start: 2, length: 3 })
  })

  it('returns null for a name the document has no entry for', () => {
    expect(dtViewSpan(DATA_TYPES, 'Missing')).toBeNull()
  })

  it('returns null for every name when the document is empty', () => {
    expect(dtViewSpan([], 'Colors')).toBeNull()
  })
})

describe('dtViewLineOffset', () => {
  it('is zero for the first entry — both frames open with their own TYPE line', () => {
    const span = dtViewSpan(DATA_TYPES, 'Colors')
    expect(span && dtViewLineOffset(span)).toBe(0)
  })

  it('shifts a later entry by its distance down the document', () => {
    const span = dtViewSpan(DATA_TYPES, 'Motor')
    expect(span && dtViewLineOffset(span)).toBe(1)
  })

  it('shifts the last entry of a longer document', () => {
    const dataTypes = [enumType('A'), enumType('B'), structType('C', ['x', 'y'])]
    const span = dtViewSpan(dataTypes, 'C')
    expect(span && dtViewLineOffset(span)).toBe(2)
  })
})

describe('dtViewWindow', () => {
  it('covers the entry lines only, never the frame line above them', () => {
    const span = dtViewSpan(DATA_TYPES, 'Motor')
    expect(span && dtViewWindow(span)).toEqual({ startLine: 2, endLineExclusive: 5 })
  })

  it('is a single line for a one-line entry', () => {
    const span = dtViewSpan(DATA_TYPES, 'Colors')
    expect(span && dtViewWindow(span)).toEqual({ startLine: 1, endLineExclusive: 2 })
  })
})

describe('diagnosticsInSpan', () => {
  it('keeps only what falls inside the entry', () => {
    const span = dtViewSpan(DATA_TYPES, 'Motor')
    const kept = span ? diagnosticsInSpan([diagnosticAt(1), diagnosticAt(3), diagnosticAt(5)], span) : []
    expect(kept.map((d) => d.message)).toEqual(['line 3'])
  })

  it('excludes the line directly above the entry — that belongs to the previous type', () => {
    const span = dtViewSpan(DATA_TYPES, 'Motor')
    expect(span && diagnosticsInSpan([diagnosticAt(1)], span)).toEqual([])
  })

  it('returns nothing when the entry is clean', () => {
    const span = dtViewSpan(DATA_TYPES, 'Colors')
    expect(span && diagnosticsInSpan([diagnosticAt(3)], span)).toEqual([])
  })
})
