/**
 * A library built from a library project with a widget block: the widget needs the HMI core only through EXTENDS of the
 * HMI element base, the library declares no header of its own, its plain blocks stay usable in PLC builds and the
 * widget is offered in the palette. Real STruC++, the installed HMI widget libraries.
 */
import { libraryPouRequirements, plcUnusablePous } from '../../../../middleware/shared/utils/library/pou-requirements'
import { loadHmiWidgetLibraries } from '../../hmi/lib/widget-libraries'
import { installedWidgetArchives } from '../../hmi/unit/__tests__/fixtures/widget-libraries'
import { libraryBuildFromTranspiledSt } from '../build-pipeline'
import { loadStrucpp } from '../strucpp-runtime'

const PLAIN =
  'FUNCTION_BLOCK Counter\n  VAR_INPUT up : BOOL; END_VAR\n  VAR_OUTPUT n : INT; END_VAR\n  n := n + 1;\nEND_FUNCTION_BLOCK\n'

const WIDGET = [
  "{attribute 'hmi_palette' := 'Tank Library'}",
  'FUNCTION_BLOCK TankLevel EXTENDS HmiElement',
  '  VAR_INPUT',
  "    {attribute 'hmi_main'}",
  '    Level : REAL;',
  '  END_VAR',
  'END_FUNCTION_BLOCK',
  '',
].join('\n')

const manifest = { name: 'tank-lib', version: '1.0.0', namespace: 'tank_lib', extra: {} }

function buildTankLibrary(extra: Record<string, unknown> = {}) {
  const result = libraryBuildFromTranspiledSt(
    PLAIN,
    [{ name: 'Counter', kind: 'FUNCTION_BLOCK' }],
    { ...manifest, extra },
    { widgetSources: [{ name: 'TankLevel', source: WIDGET }], dependencyArchives: installedWidgetArchives() },
  )
  expect(result.errors).toEqual([])
  expect(result.success).toBe(true)
  return JSON.parse(JSON.stringify(result.archive)) as {
    manifest: { name: string; headers: unknown[] }
    chunks: Array<{ name: string; headers?: Array<{ name: string; version?: string }> }>
    dependencies: Array<{ name: string }>
  }
}

describe('a library project with a widget block', () => {
  it('records the HMI core on the widget through inheritance and declares no header of its own', () => {
    const archive = buildTankLibrary()
    expect(archive.manifest.headers).toEqual([])
    expect(archive.dependencies.map((d) => d.name)).toContain('standard-widgets')
    const chunk = (name: string) => archive.chunks.find((c) => c.name === name)
    expect(chunk('TANKLEVEL')?.headers ?? []).toEqual([expect.objectContaining({ name: 'hmi_core.h' })])
    expect(chunk('COUNTER')?.headers ?? []).toEqual([])
  })

  it('keeps its plain blocks usable in PLC builds and leaves out the widget', () => {
    const archive = buildTankLibrary()
    const requirements = libraryPouRequirements([...installedWidgetArchives(), archive])
    const unusable = plcUnusablePous(requirements, ['hmi-alarms', 'standard-widgets', 'tank-lib'])
    expect([...(unusable.get('tank-lib')?.keys() ?? [])]).toEqual(['TANKLEVEL'])
  })

  it('offers the widget in the palette under its group', () => {
    const archive = buildTankLibrary()
    const { catalog, errors } = loadHmiWidgetLibraries([...installedWidgetArchives(), archive], loadStrucpp())
    expect(errors).toEqual([])
    expect(catalog.widgets.get('TANKLEVEL')).toEqual(
      expect.objectContaining({ library: 'tank-lib', palette: 'Tank Library' }),
    )
  })

  it('declares the headers library.json names for its own external code', () => {
    const archive = buildTankLibrary({ headers: [{ name: 'tank_io.h', version: '2' }] })
    expect(archive.manifest.headers).toEqual(['tank_io.h'])
  })
})
