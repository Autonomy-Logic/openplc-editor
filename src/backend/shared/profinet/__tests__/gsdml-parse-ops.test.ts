import type { GsdmlParseRequest } from '@root/middleware/shared/ports/gsdml-repository-mechanisms'

import { parseGsdml, runGsdmlParseOp, summarizeGsdmlCatalog } from '../index'
import { expectCatalog, expectError, nonPlainDataPaths, readGsdmlFixture } from './fixtures/gsdml-fixtures'

const MODULAR = readGsdmlFixture('modular-head.gsdml.xml')
const NEWER = readGsdmlFixture('newer-version.gsdml.xml')
const MALFORMED = readGsdmlFixture('structural', 'malformed-unclosed.gsdml.xml')

describe('summarizeGsdmlCatalog', () => {
  it('summarizes identity, schema version and the counts of a catalog', () => {
    const catalog = expectCatalog(parseGsdml(MODULAR))
    expect(summarizeGsdmlCatalog(catalog)).toEqual({
      vendorId: '0xf0a',
      deviceId: '0xb1',
      vendorName: 'Example Devices',
      deviceInfoText: 'Example modular device',
      schemaVersion: catalog.schemaVersion,
      deviceAccessPointCount: 3,
      moduleCount: 7,
      submoduleCount: catalog.submodules.length,
      noticeCount: 0,
    })
    expect(catalog.submodules).toHaveLength(4)
  })

  it('counts the notices of the catalog', () => {
    const catalog = expectCatalog(parseGsdml(NEWER))
    expect(summarizeGsdmlCatalog(catalog)).toMatchObject({
      vendorId: '0xf0d',
      deviceAccessPointCount: 1,
      moduleCount: 1,
      noticeCount: 2,
    })
    expect(summarizeGsdmlCatalog(catalog).schemaVersion.toUpperCase()).toBe('V2.99')
  })
})

describe('runGsdmlParseOp', () => {
  it('answers the catalog op with the parse result of the text, success included', () => {
    expect(runGsdmlParseOp({ op: 'catalog', xml: MODULAR })).toEqual({ op: 'catalog', result: parseGsdml(MODULAR) })
  })

  it('answers the catalog op with the parse error of a rejected text', () => {
    const response = runGsdmlParseOp({ op: 'catalog', xml: MALFORMED })
    expect(response).toEqual({ op: 'catalog', result: { success: false, error: expectError(parseGsdml(MALFORMED)) } })
  })

  it('answers the summary op with the summary of a successful parse', () => {
    expect(runGsdmlParseOp({ op: 'summary', xml: MODULAR })).toEqual({
      op: 'summary',
      result: { success: true, summary: summarizeGsdmlCatalog(expectCatalog(parseGsdml(MODULAR))) },
    })
  })

  it('answers the summary op with the parse error of a rejected text', () => {
    expect(runGsdmlParseOp({ op: 'summary', xml: MALFORMED })).toEqual({
      op: 'summary',
      result: { success: false, error: expectError(parseGsdml(MALFORMED)) },
    })
  })

  it('answers the summary op of an empty text with the empty-input error', () => {
    expect(runGsdmlParseOp({ op: 'summary', xml: '' })).toEqual({
      op: 'summary',
      result: { success: false, error: 'GSDML input is empty.' },
    })
  })
})

describe('SC7: thread data is structured-clone safe', () => {
  const requests: [string, GsdmlParseRequest][] = [
    ['catalog of the modular device', { op: 'catalog', xml: MODULAR }],
    ['catalog of the newer-version device', { op: 'catalog', xml: NEWER }],
    ['summary of the modular device', { op: 'summary', xml: MODULAR }],
    ['catalog of a malformed text', { op: 'catalog', xml: MALFORMED }],
  ]

  it.each(requests)('round-trips the %s through structuredClone unchanged', (_label, request) => {
    const response = runGsdmlParseOp(request)
    expect(structuredClone(response)).toEqual(response)
  })

  it.each(requests)('holds only plain objects, arrays and primitives in the %s, no Map', (_label, request) => {
    expect(nonPlainDataPaths(runGsdmlParseOp(request))).toEqual([])
  })
})
