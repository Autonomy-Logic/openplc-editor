import type { GsdmlCatalog } from '@root/middleware/shared/ports/gsdml-types'

import { GSDML_PROTOCOL_TOKENS, GSDML_RT_CLASS_TOKENS } from '../index'
import {
  type CatalogNotice,
  catalogOf,
  NEWER_INTERFACE_ID,
  newerDapSystemSubmodules,
  newerInterface,
  newerVersionWithInterface,
  noticeKinds,
  noticesOf,
} from './fixtures/gsdml-fixtures'

/** Parses a newer-than-supported file whose DAP has one InterfaceSubmoduleItem with `attributes`. */
function newerCatalog(attributes: string): GsdmlCatalog {
  return catalogOf(newerVersionWithInterface(attributes))
}

/** The `[detail, attribute named by the message]` pairs of the unknown-token notices of a catalog. */
function droppedTokens(catalog: GsdmlCatalog): string[][] {
  return noticesOf(catalog, 'unknown-token').map((notice) => [notice.detail ?? '', attributeNamed(notice)])
}

/** The TokenList attribute a notice message names, or an empty string when it names neither. */
function attributeNamed(notice: CatalogNotice): string {
  if (notice.message.includes('SupportedRT_Classes')) return 'SupportedRT_Classes'
  if (notice.message.includes('SupportedProtocols')) return 'SupportedProtocols'
  return ''
}

describe('Annex A.3.3: TokenList attributes of an InterfaceSubmoduleItem in a file newer than the supported version', () => {
  const ALL_UNKNOWN = 'SupportedRT_Classes="RT_CLASS_FUTURE;RT_CLASS_NEXT" SupportedProtocols="FUTURE_PROTOCOL"'

  it('holds the known SupportedRT_Classes tokens, in order', () => {
    expect(GSDML_RT_CLASS_TOKENS).toEqual([
      'RT_CLASS_UDP',
      'RT_CLASS_1',
      'RT_CLASS_2',
      'RT_CLASS_3',
      'RT_CLASS_STREAM_HI',
      'RT_CLASS_STREAM_LO',
    ])
  })

  it('holds the known SupportedProtocols tokens, in order', () => {
    expect(GSDML_PROTOCOL_TOKENS).toEqual(['SNMP', 'LLDP'])
  })

  it('drops an unknown SupportedRT_Classes token and keeps the known one', () => {
    const catalog = newerCatalog('SupportedRT_Classes="RT_CLASS_1;RT_CLASS_FUTURE"')
    expect(newerInterface(catalog).supportedRtClasses).toEqual(['RT_CLASS_1'])
  })

  it('gives the dropped SupportedRT_Classes token one unknown-token notice naming the attribute, token, item and V2.45', () => {
    const catalog = newerCatalog('SupportedRT_Classes="RT_CLASS_1;RT_CLASS_FUTURE"')
    const notices = noticesOf(catalog, 'unknown-token')
    expect(notices).toHaveLength(1)
    expect(notices[0].elementId).toBe(NEWER_INTERFACE_ID)
    expect(notices[0].detail).toBe('RT_CLASS_FUTURE')
    for (const part of ['SupportedRT_Classes', 'RT_CLASS_FUTURE', NEWER_INTERFACE_ID, 'V2.45']) {
      expect(notices[0].message).toContain(part)
    }
    expect(notices[0].message).toMatch(/ignored/i)
  })

  it('accepts the file and keeps its other notices beside the unknown-token one', () => {
    const catalog = newerCatalog('SupportedRT_Classes="RT_CLASS_1;RT_CLASS_FUTURE"')
    expect(noticeKinds(catalog)).toEqual(['newer-schema-version', 'object-skipped', 'unknown-token'])
  })

  it('drops an unknown SupportedProtocols token, keeps the known ones in order, with one notice naming the attribute', () => {
    const catalog = newerCatalog('SupportedProtocols="SNMP;FUTURE_PROTOCOL;LLDP"')
    expect(newerInterface(catalog).supportedProtocols).toEqual(['SNMP', 'LLDP'])
    expect(droppedTokens(catalog)).toEqual([['FUTURE_PROTOCOL', 'SupportedProtocols']])
    expect(noticesOf(catalog, 'unknown-token')[0].elementId).toBe(NEWER_INTERFACE_ID)
  })

  it('leaves both attributes empty when every token is unknown, and keeps the interface submodule', () => {
    const catalog = newerCatalog(ALL_UNKNOWN)
    expect(newerDapSystemSubmodules(catalog).map((sub) => sub.id)).toEqual([NEWER_INTERFACE_ID])
    expect(newerInterface(catalog).supportedRtClasses).toEqual([])
    expect(newerInterface(catalog).supportedProtocols).toEqual([])
  })

  it('gives one notice per dropped token when every token is unknown', () => {
    const catalog = newerCatalog(ALL_UNKNOWN)
    expect(droppedTokens(catalog).sort()).toEqual(
      [
        ['RT_CLASS_FUTURE', 'SupportedRT_Classes'],
        ['RT_CLASS_NEXT', 'SupportedRT_Classes'],
        ['FUTURE_PROTOCOL', 'SupportedProtocols'],
      ].sort(),
    )
  })

  it('matches tokens case-sensitively, so rt_class_1 is dropped with a notice', () => {
    const catalog = newerCatalog('SupportedRT_Classes="rt_class_1;RT_CLASS_2"')
    expect(newerInterface(catalog).supportedRtClasses).toEqual(['RT_CLASS_2'])
    expect(droppedTokens(catalog)).toEqual([['rt_class_1', 'SupportedRT_Classes']])
  })

  it('keeps a known token written twice, twice', () => {
    const catalog = newerCatalog('SupportedRT_Classes="RT_CLASS_1;RT_CLASS_FUTURE;RT_CLASS_1"')
    expect(newerInterface(catalog).supportedRtClasses).toEqual(['RT_CLASS_1', 'RT_CLASS_1'])
  })

  it('gives an unknown token written twice in one attribute one notice', () => {
    const catalog = newerCatalog('SupportedRT_Classes="RT_CLASS_FUTURE;RT_CLASS_1;RT_CLASS_FUTURE"')
    expect(droppedTokens(catalog)).toEqual([['RT_CLASS_FUTURE', 'SupportedRT_Classes']])
  })

  it('gives an unknown token dropped from both attributes two notices', () => {
    const catalog = newerCatalog('SupportedRT_Classes="FUTURE_TOKEN" SupportedProtocols="FUTURE_TOKEN"')
    expect(droppedTokens(catalog).sort()).toEqual([
      ['FUTURE_TOKEN', 'SupportedProtocols'],
      ['FUTURE_TOKEN', 'SupportedRT_Classes'],
    ])
  })

  it('keeps every token of the known sets, with no unknown-token notice', () => {
    const catalog = newerCatalog(
      `SupportedRT_Classes="${GSDML_RT_CLASS_TOKENS.join(';')}" SupportedProtocols="${GSDML_PROTOCOL_TOKENS.join(';')}"`,
    )
    expect(newerInterface(catalog).supportedRtClasses).toEqual([...GSDML_RT_CLASS_TOKENS])
    expect(newerInterface(catalog).supportedProtocols).toEqual([...GSDML_PROTOCOL_TOKENS])
    expect(noticesOf(catalog, 'unknown-token')).toEqual([])
  })
})
