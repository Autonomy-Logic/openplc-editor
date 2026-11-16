import type { GsdmlCatalog } from '@root/middleware/shared/ports/gsdml-types'

import { parseGsdml } from '../index'
import {
  byId,
  expectCatalog,
  noticesOf,
  readGsdmlFixture,
  replaceOnce,
  unresolvedPlacements,
} from './fixtures/gsdml-fixtures'

const NEWER = readGsdmlFixture('newer-version.gsdml.xml')
const BOUNDARIES = readGsdmlFixture('schema-version-boundaries.gsdml.xml')
const BASE = readGsdmlFixture('structural-base.gsdml.xml')

const N_MOD_REF = '<ModuleItemRef ModuleItemTarget="N_MOD" AllowedInSlots="1..2" FutureRefAttribute="y" />'
const N_FUTURE_MOD_REF = '<ModuleItemRef ModuleItemTarget="N_FUTURE_MOD" AllowedInSlots="2" UsedInSlots="2" />'
const VB_225_ITEM = '<ModuleItem ID="VB_225" RequiredSchemaVersion="V2.25" ModuleIdentNumber="0x00000E10" />'
const VB_DAP_NEW_START = '<DeviceAccessPointItem ID="VB_DAP_NEW"'

/** A SubmoduleItemRef target and its AllowedInSubslots value. */
type SubmoduleRef = readonly [target: string, subslots: string]

/** Parses `xml` and returns its catalog. */
function catalogOf(xml: string): GsdmlCatalog {
  return expectCatalog(parseGsdml(xml))
}

/** The UseableSubmodules element holding one SubmoduleItemRef per entry, in order. */
function useableSubmodules(refs: readonly SubmoduleRef[]): string {
  const items = refs.map(
    ([target, subslots]) => `<SubmoduleItemRef SubmoduleItemTarget="${target}" AllowedInSubslots="${subslots}" />`,
  )
  return `<UseableSubmodules>${items.join('')}</UseableSubmodules>`
}

/** The version-boundaries fixture with UseableSubmodules on its device access point VB_DAP. */
function withDapSubmoduleRefs(xml: string, refs: readonly SubmoduleRef[]): string {
  return replaceOnce(xml, '</UseableModules>', `</UseableModules>${useableSubmodules(refs)}`)
}

/** The version-boundaries fixture with UseableSubmodules on its module VB_225. */
function withModuleSubmoduleRefs(xml: string, refs: readonly SubmoduleRef[]): string {
  const opening = VB_225_ITEM.replace(' />', '>')
  return replaceOnce(xml, VB_225_ITEM, `${opening}${useableSubmodules(refs)}</ModuleItem>`)
}

/** The version-boundaries fixture with a second supported device access point VB_DAP_TWO holding `moduleRefs`. */
function withSecondDap(moduleRefs: string): string {
  const dap =
    '<DeviceAccessPointItem ID="VB_DAP_TWO" PhysicalSlots="0..4" ModuleIdentNumber="0x00000E03" FixedInSlots="0" ' +
    'MinDeviceInterval="32" DNS_CompatibleName="versions-two" ObjectUUID_LocalIndex="2">' +
    `<ModuleInfo><Name TextId="V_Text" /></ModuleInfo><UseableModules>${moduleRefs}</UseableModules>` +
    '</DeviceAccessPointItem>'
  return replaceOnce(BOUNDARIES, VB_DAP_NEW_START, `${dap}${VB_DAP_NEW_START}`)
}

/** The newer-version fixture with its ModuleList moved in front of the DeviceAccessPointList. */
function withModuleListFirst(xml: string): string {
  const moduleList = /<ModuleList>[\s\S]*<\/ModuleList>/.exec(xml)
  if (moduleList === null) throw new Error('Expected a ModuleList in the fixture')
  const withoutList = replaceOnce(xml, moduleList[0], '')
  return replaceOnce(withoutList, '<DeviceAccessPointList>', `${moduleList[0]}<DeviceAccessPointList>`)
}

const DAP_MODULE_REF_TO_SKIPPED = replaceOnce(NEWER, N_MOD_REF, `${N_MOD_REF}${N_FUTURE_MOD_REF}`)

const DAP_MODULE_REF_TO_SKIPPED_LIST_FIRST = withModuleListFirst(DAP_MODULE_REF_TO_SKIPPED)

const DAP_MODULE_REFS_INTERLEAVED = replaceOnce(
  replaceOnce(
    BOUNDARIES,
    '<ModuleItemRef ModuleItemTarget="VB_225" AllowedInSlots="1..8" />',
    '<ModuleItemRef ModuleItemTarget="VB_25" AllowedInSlots="1" />' +
      '<ModuleItemRef ModuleItemTarget="VB_225" AllowedInSlots="1..8" />' +
      '<ModuleItemRef ModuleItemTarget="VB_2451" AllowedInSlots="2" FixedInSlots="2" />',
  ),
  '<ModuleItemRef ModuleItemTarget="VB_24" AllowedInSlots="1..8" />',
  '<ModuleItemRef ModuleItemTarget="VB_24" AllowedInSlots="1..8" />' +
    '<ModuleItemRef ModuleItemTarget="VB_30" AllowedInSlots="3..4" UsedInSlots="3" />' +
    '<ModuleItemRef ModuleItemTarget="VB_299_LOWER" AllowedInSlots="5" />',
)

const DAP_SUBMODULE_REFS_BASELINE = withDapSubmoduleRefs(BOUNDARIES, [['VB_SUB_OK', '1']])
const DAP_SUBMODULE_REF_TO_SKIPPED = withDapSubmoduleRefs(BOUNDARIES, [
  ['VB_SUB_NEW', '2'],
  ['VB_SUB_OK', '1'],
])

const MODULE_SUBMODULE_REFS_BASELINE = withModuleSubmoduleRefs(BOUNDARIES, [['VB_SUB_OK', '2']])
const MODULE_SUBMODULE_REF_TO_SKIPPED_PORT = withModuleSubmoduleRefs(BOUNDARIES, [
  ['VB_SUB_OK', '2'],
  ['VB_PORT_NEW', '3'],
])

const DAP_AND_MODULE_REFS_TO_ONE_SKIPPED = withModuleSubmoduleRefs(
  withDapSubmoduleRefs(BOUNDARIES, [['VB_SUB_NEW', '1']]),
  [['VB_SUB_NEW', '2']],
)

const VB_23_REF = '<ModuleItemRef ModuleItemTarget="VB_23" AllowedInSlots="2" />'
const VB_30_REF = '<ModuleItemRef ModuleItemTarget="VB_30" AllowedInSlots="1" />'
const TWO_DAPS_BASELINE = withSecondDap(VB_23_REF)
const TWO_DAPS_REFS_TO_ONE_SKIPPED = replaceOnce(
  withSecondDap(`${VB_30_REF}${VB_23_REF}`),
  '<ModuleItemRef ModuleItemTarget="VB_245_LOWER" AllowedInSlots="1..8" />',
  `<ModuleItemRef ModuleItemTarget="VB_245_LOWER" AllowedInSlots="1..8" />${VB_30_REF}`,
)

describe('Annex A.3.3: module placements whose target was skipped', () => {
  it('drops a ModuleItemRef of a device access point naming a skipped ModuleItem', () => {
    const dap = byId(catalogOf(DAP_MODULE_REF_TO_SKIPPED).deviceAccessPoints, 'N_DAP')
    expect(dap.useableModules.map((placement) => placement.moduleId)).toEqual(['N_MOD'])
  })

  it('keeps the remaining placement with the values it has without the dropped reference', () => {
    const dap = byId(catalogOf(DAP_MODULE_REF_TO_SKIPPED).deviceAccessPoints, 'N_DAP')
    const baseline = byId(catalogOf(NEWER).deviceAccessPoints, 'N_DAP')
    expect(dap.useableModules).toEqual(baseline.useableModules)
  })

  it('adds no notice for the dropped placement: the notices equal those of the file without it', () => {
    const catalog = catalogOf(DAP_MODULE_REF_TO_SKIPPED)
    expect(catalog.notices).toEqual(catalogOf(NEWER).notices)
    expect(noticesOf(catalog, 'dangling-reference')).toEqual([])
    expect(noticesOf(catalog, 'object-skipped').map((notice) => notice.elementId)).toEqual(['N_FUTURE_MOD'])
  })

  it('drops the placement whatever the position of the ModuleList relative to the reference', () => {
    const catalog = catalogOf(DAP_MODULE_REF_TO_SKIPPED_LIST_FIRST)
    expect(byId(catalog.deviceAccessPoints, 'N_DAP').useableModules.map((placement) => placement.moduleId)).toEqual([
      'N_MOD',
    ])
    expect(noticesOf(catalog, 'dangling-reference')).toEqual([])
  })

  it('drops interleaved placements to skipped modules and keeps the others in document order with their values', () => {
    const dap = byId(catalogOf(DAP_MODULE_REFS_INTERLEAVED).deviceAccessPoints, 'VB_DAP')
    const baseline = byId(catalogOf(BOUNDARIES).deviceAccessPoints, 'VB_DAP')
    expect(dap.useableModules.map((placement) => placement.moduleId)).toEqual([
      'VB_225',
      'VB_23',
      'VB_24',
      'VB_245_LOWER',
    ])
    expect(dap.useableModules).toEqual(baseline.useableModules)
  })

  it('leaves the notices of interleaved placements to skipped modules equal to those of the file without them', () => {
    expect(catalogOf(DAP_MODULE_REFS_INTERLEAVED).notices).toEqual(catalogOf(BOUNDARIES).notices)
  })
})

describe('Annex A.3.3: submodule placements whose target was skipped', () => {
  it('drops a SubmoduleItemRef of a device access point naming a skipped SubmoduleList SubmoduleItem', () => {
    const dap = byId(catalogOf(DAP_SUBMODULE_REF_TO_SKIPPED).deviceAccessPoints, 'VB_DAP')
    const baseline = byId(catalogOf(DAP_SUBMODULE_REFS_BASELINE).deviceAccessPoints, 'VB_DAP')
    expect(dap.useableSubmodules.map((placement) => placement.submoduleId)).toEqual(['VB_SUB_OK'])
    expect(dap.useableSubmodules).toEqual(baseline.useableSubmodules)
  })

  it('adds no notice for a dropped device access point submodule placement', () => {
    expect(catalogOf(DAP_SUBMODULE_REF_TO_SKIPPED).notices).toEqual(catalogOf(DAP_SUBMODULE_REFS_BASELINE).notices)
  })

  it('drops a SubmoduleItemRef of a ModuleItem naming a skipped SubmoduleList PortSubmoduleItem', () => {
    const mod = byId(catalogOf(MODULE_SUBMODULE_REF_TO_SKIPPED_PORT).modules, 'VB_225')
    const baseline = byId(catalogOf(MODULE_SUBMODULE_REFS_BASELINE).modules, 'VB_225')
    expect(mod.useableSubmodules.map((placement) => placement.submoduleId)).toEqual(['VB_SUB_OK'])
    expect(mod.useableSubmodules).toEqual(baseline.useableSubmodules)
  })

  it('adds no notice for a dropped module submodule placement', () => {
    expect(catalogOf(MODULE_SUBMODULE_REF_TO_SKIPPED_PORT).notices).toEqual(
      catalogOf(MODULE_SUBMODULE_REFS_BASELINE).notices,
    )
  })
})

describe('Annex A.3.3: several placements naming one skipped object', () => {
  it('drops the placements of a device access point and a ModuleItem naming one skipped submodule', () => {
    const catalog = catalogOf(DAP_AND_MODULE_REFS_TO_ONE_SKIPPED)
    expect(byId(catalog.deviceAccessPoints, 'VB_DAP').useableSubmodules).toEqual([])
    expect(byId(catalog.modules, 'VB_225').useableSubmodules).toEqual([])
  })

  it('keeps one object-skipped notice for a submodule named by two placements, and no dangling-reference', () => {
    const catalog = catalogOf(DAP_AND_MODULE_REFS_TO_ONE_SKIPPED)
    expect(noticesOf(catalog, 'object-skipped').filter((notice) => notice.elementId === 'VB_SUB_NEW')).toHaveLength(1)
    expect(noticesOf(catalog, 'dangling-reference')).toEqual([])
    expect(catalog.notices).toEqual(catalogOf(BOUNDARIES).notices)
  })

  it('drops the placements of two device access points naming one skipped module', () => {
    const catalog = catalogOf(TWO_DAPS_REFS_TO_ONE_SKIPPED)
    const baseline = catalogOf(TWO_DAPS_BASELINE)
    expect(byId(catalog.deviceAccessPoints, 'VB_DAP').useableModules).toEqual(
      byId(baseline.deviceAccessPoints, 'VB_DAP').useableModules,
    )
    expect(byId(catalog.deviceAccessPoints, 'VB_DAP_TWO').useableModules).toEqual(
      byId(baseline.deviceAccessPoints, 'VB_DAP_TWO').useableModules,
    )
  })

  it('keeps one object-skipped notice for a module named by two device access points, and no dangling-reference', () => {
    const catalog = catalogOf(TWO_DAPS_REFS_TO_ONE_SKIPPED)
    expect(noticesOf(catalog, 'object-skipped').filter((notice) => notice.elementId === 'VB_30')).toHaveLength(1)
    expect(noticesOf(catalog, 'dangling-reference')).toEqual([])
    expect(catalog.notices).toEqual(catalogOf(TWO_DAPS_BASELINE).notices)
  })
})

describe('placement invariant: every placement names a catalog object or a dangling-reference target', () => {
  it.each([
    ['modular-head.gsdml.xml', readGsdmlFixture('modular-head.gsdml.xml')],
    ['compact-head.gsdml.xml', readGsdmlFixture('compact-head.gsdml.xml')],
    ['logbook.gsdml.xml', readGsdmlFixture('logbook.gsdml.xml')],
    ['bulk-char-refs.gsdml.xml', readGsdmlFixture('bulk-char-refs.gsdml.xml')],
    ['structural-base.gsdml.xml', BASE],
    ['newer-version.gsdml.xml', NEWER],
    ['schema-version-boundaries.gsdml.xml', BOUNDARIES],
    ['a ModuleItemRef naming no element', replaceOnce(BASE, 'ModuleItemTarget="B_MOD"', 'ModuleItemTarget="B_NONE"')],
    [
      'a SubmoduleItemRef naming no element',
      replaceOnce(BASE, 'SubmoduleItemTarget="B_SUB"', 'SubmoduleItemTarget="B_NONE"'),
    ],
  ])('holds for %s', (_label, xml) => {
    expect(unresolvedPlacements(catalogOf(xml))).toEqual([])
  })

  it.each([
    ['a module placement to a skipped ModuleItem', DAP_MODULE_REF_TO_SKIPPED],
    ['a module placement to a skipped ModuleItem listed first', DAP_MODULE_REF_TO_SKIPPED_LIST_FIRST],
    ['interleaved module placements to skipped ModuleItems', DAP_MODULE_REFS_INTERLEAVED],
    ['a submodule placement to a skipped SubmoduleItem', DAP_SUBMODULE_REF_TO_SKIPPED],
    ['a module submodule placement to a skipped PortSubmoduleItem', MODULE_SUBMODULE_REF_TO_SKIPPED_PORT],
    ['two submodule placements to one skipped SubmoduleItem', DAP_AND_MODULE_REFS_TO_ONE_SKIPPED],
    ['two device access points placing one skipped ModuleItem', TWO_DAPS_REFS_TO_ONE_SKIPPED],
  ])('holds for %s', (_label, xml) => {
    expect(unresolvedPlacements(catalogOf(xml))).toEqual([])
  })

  it('keeps a reference naming no element, so the dangling-reference exception is exercised', () => {
    const catalog = catalogOf(replaceOnce(BASE, 'SubmoduleItemTarget="B_SUB"', 'SubmoduleItemTarget="B_NONE"'))
    expect(byId(catalog.modules, 'B_MOD').useableSubmodules.map((placement) => placement.submoduleId)).toEqual([
      'B_NONE',
    ])
    expect(noticesOf(catalog, 'dangling-reference').map((notice) => notice.detail)).toEqual(['B_NONE'])
  })
})
