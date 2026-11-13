import type { StlibArchive } from 'strucpp'

import { HMI_LIBRARY_NAMES, hmiReservedName } from '../../../../../middleware/shared/utils/hmi/reserved-names'

import { __setStrucppRuntimeForTests, loadStrucpp, type StrucppRuntime } from '../../../library/strucpp-runtime'
import {
  buildStandardWidgets,
  clearStandardWidgetsCache,
  type StandardWidgetsBuild,
  standardWidgetsKey,
} from '../build-standard-widgets'
import { STANDARD_WIDGETS_LIBRARY, STANDARD_WIDGETS_SOURCES } from '../standard-widgets'

function archiveOf(build: StandardWidgetsBuild): StlibArchive {
  if (!build.ok) throw new Error(build.errors.map((e) => `${e.file ?? ''}:${e.line ?? 0}: ${e.message}`).join('\n'))
  return build.archive
}

/** Compiles a consumer program against the library and returns its error messages. */
function consumerErrors(source: string): string[] {
  const archive = archiveOf(buildStandardWidgets())
  return loadStrucpp()
    .compile(source, { libraries: [archive] })
    .errors.map((e) => e.message)
}

const FR18_WIDGETS = [
  'HmiStack',
  'HmiDiagram',
  'HmiLabel',
  'HmiValue',
  'HmiLamp',
  'HmiGauge',
  'HmiTank',
  'HmiTrend',
  'HmiReadout',
  'HmiVessel',
  'HmiButton',
  'HmiSwitch',
  'HmiSlider',
  'HmiNumericInput',
  'HmiTextInput',
  'HmiPump',
  'HmiValve',
  'HmiPipe',
  'HmiRect',
]

describe('StandardWidgets library', () => {
  afterEach(() => {
    clearStandardWidgetsCache()
    __setStrucppRuntimeForTests(null)
  })

  it('compiles with STruC++ into an archive that declares every widget and the header its external code needs', () => {
    const archive = archiveOf(buildStandardWidgets())
    expect(archive.manifest.name).toBe(STANDARD_WIDGETS_LIBRARY.name)
    expect(archive.manifest.headers).toEqual(['hmi_core.h'])
    const names = archive.manifest.functionBlocks.map((fb) => fb.displayName ?? fb.name)
    expect(names).toEqual(expect.arrayContaining([...FR18_WIDGETS, 'HmiElement', 'HmiScreen', 'HmiRuntime']))
  })

  it('compiles once per session and again when the compiler changes', () => {
    const first = buildStandardWidgets()
    expect(buildStandardWidgets()).toBe(first)
    const real = loadStrucpp()
    const compileStlib = jest.fn(real.compileStlib)
    const other: StrucppRuntime = { ...real, compileStlib, getVersion: () => 'other' }
    __setStrucppRuntimeForTests(other)
    const second = buildStandardWidgets()
    expect(second).not.toBe(first)
    expect(second.key).toBe(standardWidgetsKey('other'))
    expect(compileStlib).toHaveBeenCalledTimes(1)
  })

  it('reports compile errors instead of an archive', () => {
    const real = loadStrucpp()
    __setStrucppRuntimeForTests({
      ...real,
      compileStlib: () => ({
        ...real.compileStlib([], { name: 'x', version: '1.0.0', namespace: 'x' }),
        errors: [{ message: 'boom', line: 3, file: 'a.st' }],
      }),
    })
    expect(buildStandardWidgets()).toEqual({
      ok: false,
      key: expect.any(String),
      errors: [{ message: 'boom', line: 3, file: 'a.st' }],
    })
  })

  it('keys the cache on every source', () => {
    const key = standardWidgetsKey('1')
    expect(standardWidgetsKey('1')).toBe(key)
    const source = STANDARD_WIDGETS_SOURCES[0]
    const original = source.source
    try {
      source.source = `${original} `
      expect(standardWidgetsKey('1')).not.toBe(key)
    } finally {
      source.source = original
    }
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
    expect(consumerErrors('PROGRAM P VAR l : HmiLabel; ok : BOOL; END_VAR ok := l.Draw(); END_PROGRAM')).toEqual([
      expect.stringMatching(/PROTECTED/i),
    ])
  })

  it('lets a widget block override the PROTECTED surface and screens extend HmiScreen', () => {
    expect(
      consumerErrors(`FUNCTION_BLOCK Badge EXTENDS HmiElement
  VAR_INPUT {attribute 'hmi_main'} Value : BOOL; END_VAR
  METHOD PROTECTED OVERRIDE NaturalWidth : DINT NaturalWidth := 40; END_METHOD
  METHOD PROTECTED OVERRIDE TakesInput : BOOL TakesInput := TRUE; END_METHOD
  METHOD PROTECTED OVERRIDE Draw : BOOL
    HMI_FillCircle(CenterX(), CenterY(), 10, SEL(Value, COLOR.Border, COLOR.Success));
    IF PointerOver() AND HMI_PtrPressed() THEN KeyboardOpen('1', 'Title', TRUE); END_IF;
    Draw := TRUE;
  END_METHOD
END_FUNCTION_BLOCK
FUNCTION_BLOCK Main EXTENDS HmiScreen
  VAR B : Badge; S : HmiStack; END_VAR
  METHOD PROTECTED OVERRIDE Build : BOOL Attach(ADR(S), 0); Attach(ADR(B), ADR(S)); Build := TRUE; END_METHOD
  METHOD PROTECTED OVERRIDE OnShow : BOOL B.Value := TRUE; OnShow := TRUE; END_METHOD
END_FUNCTION_BLOCK`),
    ).toEqual([])
  })
})

describe('reserved HMI names', () => {
  it('list exactly what the library declares', () => {
    const build = buildStandardWidgets()
    if (!build.ok) throw new Error('library does not compile')
    const m = build.archive.manifest
    const declared = [...m.functions, ...m.functionBlocks, ...m.types, ...(m.globals ?? []), ...(m.interfaces ?? [])]
      .map((x) => x.displayName ?? x.name)
      .sort()
    expect([...HMI_LIBRARY_NAMES].sort()).toEqual(declared)
  })

  it('refuse library and generated names in any case, and generated prefixes', () => {
    for (const name of ['HmiButton', 'hmibutton', 'COLOR', 'HMI_Show', 'hmi_main', 'HMI__Request', 'HMI_THEME_Brand'])
      expect(hmiReservedName(name)).toBe(`"${name}" is taken by the HMI library`)
    for (const name of ['Overview', 'HmiButtonPanel', 'MyColor']) expect(hmiReservedName(name)).toBeNull()
  })
})
