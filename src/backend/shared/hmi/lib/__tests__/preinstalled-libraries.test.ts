import { findUnmetRequirements, resolvePouRequirements, type StlibArchive } from 'strucpp'

import {
  HMI_CORE_API_VERSION,
  HMI_PROVIDED_HEADERS,
  PLC_PROVIDED_HEADERS,
} from '../../../../../middleware/shared/utils/hmi/widget-libraries'
import {
  HMI_ALARMS_LIBRARY_NAMES,
  HMI_LIBRARY_NAMES,
  hmiReservedName,
} from '../../../../../middleware/shared/utils/hmi/reserved-names'
import { runProgramBuildPipeline } from '../../../library/program-build-pipeline'
import { loadStrucpp } from '../../../library/strucpp-runtime'
import { installedArchiveText, installedWidgetArchives } from '../../unit/__tests__/fixtures/widget-libraries'

const load = (name: string): StlibArchive => loadStrucpp().loadStlibFromString(installedArchiveText(name), name)

/** Compiles a consumer program against standard-widgets and returns its error messages. */
function consumerErrors(source: string): string[] {
  return loadStrucpp()
    .compile(source, { libraries: [load('standard-widgets')] })
    .errors.map((e) => e.message)
}

const declaredNames = (archive: StlibArchive, withGlobals: boolean): string[] => {
  const m = archive.manifest
  return [
    ...m.functions,
    ...m.functionBlocks,
    ...m.types,
    ...(withGlobals ? [...(m.globals ?? []), ...(m.interfaces ?? [])] : []),
  ].map((x) => x.displayName ?? x.name)
}

describe('pre-installed standard-widgets', () => {
  it('declares every widget and the HMI core header its external code needs, at this API version', () => {
    const archive = load('standard-widgets')
    expect(archive.manifest.headers).toEqual(['hmi_core.h'])
    expect(JSON.parse(installedArchiveText('standard-widgets'))).toMatchObject({
      manifest: { displayName: 'HMI Standard Widgets' },
    })
    expect(declaredNames(archive, false)).toEqual(
      expect.arrayContaining(['HmiButton', 'HmiTrend', 'HmiAlarmList', 'HmiElement', 'HmiScreen', 'HmiRuntime']),
    )
    expect(archive.manifest.headerVersions).toEqual({ 'hmi_core.h': String(HMI_CORE_API_VERSION) })
    expect(JSON.parse(installedArchiveText('standard-widgets'))).not.toHaveProperty('openplc')
  })

  it('needs the HMI core for its widgets but not for its types, so only HMI builds can use the widgets', () => {
    const archive = load('standard-widgets')
    const pous = new Map(resolvePouRequirements(archive).map((p) => [p.name, p.requirements]))
    const unmet = (name: string, providedHeaders: typeof HMI_PROVIDED_HEADERS) =>
      findUnmetRequirements(pous.get(name) ?? [], { libraries: [archive], providedHeaders: [...providedHeaders] })
    for (const widget of ['HMIELEMENT', 'HMIBUTTON', 'HMIGAUGE']) {
      expect(unmet(widget, PLC_PROVIDED_HEADERS)).toHaveLength(1)
      expect(unmet(widget, HMI_PROVIDED_HEADERS)).toEqual([])
    }
    expect(unmet('HMI_ALIGN', PLC_PROVIDED_HEADERS)).toEqual([])
  })

  it('keeps the engine internal: screens and widget blocks cannot call or override it', () => {
    expect(consumerErrors('PROGRAM P VAR l : HmiLabel; ok : BOOL; END_VAR ok := l.Render(); END_PROGRAM')).toEqual([
      expect.stringMatching(/INTERNAL method 'RENDER'/i),
    ])
    expect(
      consumerErrors(`FUNCTION_BLOCK W EXTENDS HmiElement
  METHOD INTERNAL OVERRIDE Render : BOOL Render := TRUE; END_METHOD
END_FUNCTION_BLOCK`),
    ).toEqual([expect.stringMatching(/cannot override INTERNAL method/i)])
  })

  it('cannot instantiate the stack and container bases, only the two stacks and the diagram', () => {
    expect(consumerErrors('PROGRAM P VAR s : HmiStack; END_VAR END_PROGRAM')).not.toEqual([])
    expect(
      consumerErrors('PROGRAM P VAR v : HmiVerticalStack; h : HmiHorizontalStack; d : HmiDiagram; END_VAR END_PROGRAM'),
    ).toEqual([])
  })

  it('declares exactly the names screens and widget blocks may not take', () => {
    expect([...HMI_LIBRARY_NAMES].sort()).toEqual(declaredNames(load('standard-widgets'), true).sort())
    for (const name of ['HmiButton', 'hmibutton', 'COLOR', 'HMI_Show', 'HMI_ALARM_ROW'])
      expect(hmiReservedName(name)).toBe(`"${name}" is taken by the HMI library`)
  })
})

describe('pre-installed hmi-alarms', () => {
  const PROGRAM = `PROGRAM Main
  VAR
    Alarms : ARRAY[1..4] OF HMI_ALARM_ROW;
    Events : ARRAY[0..9] OF HMI_EVENT_ROW;
    Sys : HMI_ALARM_SUMMARY;
    High : BOOL;
  END_VAR
  HMI_ALARM(In := High, Id := 1, Message := 'Level high', Table := Alarms);
  HMI_ALARMS(Summary := Sys, Table := Alarms);
  HMI_ALARM_LOGGER(Table := Alarms, Events := Events);
END_PROGRAM
CONFIGURATION Config0
  RESOURCE Res0 ON PLC
    TASK task0(INTERVAL := T#20ms, PRIORITY := 1);
    PROGRAM instance0 WITH task0 : Main;
  END_RESOURCE
END_CONFIGURATION
`

  it('declares exactly the names the HMI reserves, and needs no header', () => {
    const archive = load('hmi-alarms')
    expect(JSON.parse(installedArchiveText('hmi-alarms'))).toMatchObject({ manifest: { displayName: 'HMI Alarms' } })
    expect(
      declaredNames(archive, false)
        .map((n) => n.toUpperCase())
        .sort(),
    ).toEqual([...HMI_ALARMS_LIBRARY_NAMES].sort())
    expect(archive.manifest.headers).toEqual([])
    for (const pou of resolvePouRequirements(archive))
      expect(findUnmetRequirements(pou.requirements, { libraries: [archive], providedHeaders: [] })).toEqual([])
  })

  it('compiles a PLC program that uses it, and refuses one that uses a widget, with every library installed', () => {
    const result = runProgramBuildPipeline({
      source: PROGRAM,
      md5: '0',
      pous: [],
      libraries: installedWidgetArchives(),
      missingLibraries: [],
      hasCBlocks: false,
    })
    expect(result.errors.map((e) => e.formatted)).toEqual([])
    expect(result.files.map((f) => f.content).join('\n')).toContain('HMI_ALARMS')
    const without = runProgramBuildPipeline({
      source: 'PROGRAM Main VAR b : HmiButton; END_VAR END_PROGRAM',
      md5: '0',
      pous: [],
      libraries: installedWidgetArchives(),
      missingLibraries: [],
      hasCBlocks: false,
    })
    expect(without.success).toBe(false)
    expect(without.errors.map((e) => e.raw.message)).toEqual([
      expect.stringContaining('HMIBUTTON (library standard-widgets) needs hmi_core.h version'),
    ])
  })
})
