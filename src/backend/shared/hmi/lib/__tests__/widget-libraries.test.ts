import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { HmiPreviewMechanisms } from '../../../../../middleware/shared/ports/hmi-preview-mechanisms'
import { HMI_CORE_API_VERSION } from '../../../../../middleware/shared/utils/hmi/widget-libraries'
import { loadStrucpp } from '../../../library/strucpp-runtime'
import { createHmiPreviewPort } from '../../preview/hmi-preview-port'
import { installedArchiveText, installedWidgetArchives } from '../../unit/__tests__/fixtures/widget-libraries'
import { buildHmiWidgetCatalog, generateHmiUnit } from '../../unit/generate-hmi-unit'
import { sampleProject } from '../../unit/__tests__/fixtures/sample-project'
import { loadHmiWidgetLibraries, widgetLibraryNames, withSkippedLibraryCause } from '../widget-libraries'

const CORE = String(HMI_CORE_API_VERSION)
const OTHER = String(HMI_CORE_API_VERSION + 1)

/** A user library compiled like any other: one widget on top of standard-widgets and one plain function. */
function extraWidgetLibrary(extraHeaders: Array<string | { name: string; version?: string }> = []): object {
  const strucpp = loadStrucpp()
  const base = strucpp.loadStlibFromString(installedArchiveText('standard-widgets'), 'standard-widgets')
  const compiled = strucpp.compileStlib(
    [
      {
        fileName: 'dial.st',
        source: `{attribute 'hmi_palette' := 'Gauges'}
FUNCTION_BLOCK HmiDial EXTENDS HmiLamp
  VAR_INPUT Sweep : INT := 270; END_VAR
END_FUNCTION_BLOCK
FUNCTION DialScale : INT
  VAR_INPUT X : INT; END_VAR
  DialScale := X * 2;
END_FUNCTION
`,
      },
      ...(extraHeaders.length > 0
        ? [
            {
              fileName: 'vendor.st',
              source: `{attribute 'headers' := 'vendor_api.h'}
FUNCTION_BLOCK HmiVendorDial EXTENDS HmiLamp
  VAR_INPUT Level : INT; END_VAR
  {external vendor_poll(); }
END_FUNCTION_BLOCK
`,
            },
          ]
        : []),
    ],
    {
      name: 'extra-widgets',
      version: '1.0.0',
      namespace: 'extra_widgets',
      headers: [{ name: 'hmi_core.h', version: CORE }, ...extraHeaders],
      dependencies: [base],
    },
  )
  if (compiled.errors.length > 0) throw new Error(compiled.errors.map((e) => e.message).join('\n'))
  return JSON.parse(JSON.stringify(compiled.archive))
}

/** `extraWidgetLibrary` as if compiled against another HMI core API. */
function otherCoreLibrary(): object {
  return JSON.parse(
    JSON.stringify(extraWidgetLibrary())
      .replaceAll(`"name":"hmi_core.h","version":"${CORE}"`, `"name":"hmi_core.h","version":"${OTHER}"`)
      .replace(`"hmi_core.h":"${CORE}"`, `"hmi_core.h":"${OTHER}"`),
  )
}

describe('installed libraries in HMI builds', () => {
  it('loads every installed library, with no kind, and derives the widget catalogue from them', () => {
    const { libraries, catalog, errors } = loadHmiWidgetLibraries(installedWidgetArchives())
    expect(errors).toEqual([])
    expect(libraries.map((l) => l.name)).toEqual(['hmi-alarms', 'standard-widgets'])
    expect(catalog.widgets.get('HMIBUTTON')?.palette).toBe('Controls')
    expect([...widgetLibraryNames(catalog)]).toEqual(['standard-widgets'])
  })

  it('says how to recover when no installed library declares a widget', () => {
    expect(loadHmiWidgetLibraries([]).errors).toEqual([
      { file: 'HMI', message: expect.stringContaining('No installed library declares an HMI widget') },
    ])
  })

  const skippedWarning =
    `The library "extra-widgets" is left out of HMI builds: it is built for HMI core API ${OTHER}, but this ` +
    `editor provides HMI core API ${CORE}. Install a build of the library for HMI core API ${CORE}.`

  it('leaves out a library built for another HMI core API with one warning, and keeps the others', () => {
    const { libraries, errors, warnings, skipped } = loadHmiWidgetLibraries([
      ...installedWidgetArchives(),
      otherCoreLibrary(),
      otherCoreLibrary(),
    ])
    expect(libraries.map((l) => l.name)).toEqual(['hmi-alarms', 'standard-widgets'])
    expect(errors).toEqual([])
    expect(warnings).toEqual([{ file: 'HMI', message: skippedWarning }])
    expect(skipped).toEqual([
      { name: 'extra-widgets', required: OTHER, provided: CORE, names: ['DIALSCALE', 'HMIDIAL'] },
    ])
  })

  it('builds a project that does not use the left-out library, with the warning', () => {
    const unit = generateHmiUnit({
      ...sampleProject(),
      installedLibraries: [...installedWidgetArchives(), otherCoreLibrary()],
    })
    expect(unit.errors).toEqual([])
    expect(unit.ok).toBe(true)
    expect(unit.warnings.filter((w) => w.message === skippedWarning)).toHaveLength(1)
  })

  it('names the left-out library in the unknown widget type error of a project that uses its widgets', () => {
    const project = sampleProject()
    const screen = project.screens[1].source.replace('END_VAR', "  Dial : HmiDial := (Parent := 'Body');\nEND_VAR")
    const unit = generateHmiUnit({
      ...project,
      screens: [project.screens[0], { ...project.screens[1], source: screen }],
      installedLibraries: [...installedWidgetArchives(), otherCoreLibrary()],
    })
    expect(unit.ok).toBe(false)
    expect(unit.errors).toEqual([
      expect.objectContaining({
        file: 'Details',
        message:
          `Undefined type 'HMIDIAL' in FUNCTION_BLOCK 'DETAILS' (the library "extra-widgets" declares it but is left ` +
          `out of HMI builds: it is built for HMI core API ${OTHER}, but this editor provides HMI core API ${CORE})`,
      }),
    ])
    expect(unit.warnings.map((w) => w.message)).toContain(skippedWarning)
  })

  it('leaves an unknown widget type error alone when no left-out library declares the type', () => {
    const skipped = [{ name: 'extra-widgets', required: OTHER, provided: CORE, names: ['HMIDIAL'] }]
    for (const list of [[], skipped])
      expect(withSkippedLibraryCause("Undefined type 'HMIGAUGE' in FUNCTION_BLOCK 'X'", list)).toBe(
        "Undefined type 'HMIGAUGE' in FUNCTION_BLOCK 'X'",
      )
    expect(withSkippedLibraryCause('Something else', skipped)).toBe('Something else')
  })

  it('puts the widgets of an installed library in the catalogue, and builds screens that use them', () => {
    const installed = [...installedWidgetArchives(), extraWidgetLibrary()]
    const { catalog, errors } = buildHmiWidgetCatalog([], installed)
    expect(errors).toEqual([])
    expect(catalog.widgets.get('HMIDIAL')).toMatchObject({ library: 'extra-widgets', palette: 'Gauges' })
    expect(catalog.widgets.has('DIALSCALE')).toBe(false)
    expect(catalog.widgets.get('HMIDIAL')?.properties.find((p) => p.name === 'Sweep')).toMatchObject({
      defaultValue: '270',
    })
    const project = sampleProject()
    const screen = project.screens[1].source.replace('END_VAR', "  Dial : HmiDial := (Parent := 'Body');\nEND_VAR")
    const unit = generateHmiUnit({
      ...project,
      screens: [project.screens[0], { ...project.screens[1], source: screen }],
      installedLibraries: installed,
    })
    expect(unit.errors).toEqual([])
    expect(Object.keys(unit.files)).toContain('lib_extra_widgets.cpp')
  })

  it("refuses a widget whose requirements the HMI build cannot meet, with STruC++'s reason", () => {
    const installed = [...installedWidgetArchives(), extraWidgetLibrary(['vendor_api.h'])]
    expect(buildHmiWidgetCatalog([], installed).catalog.widgets.has('HMIVENDORDIAL')).toBe(true)
    const project = sampleProject()
    const screen = project.screens[1].source.replace(
      'END_VAR',
      "  Dial : HmiVendorDial := (Parent := 'Body');\nEND_VAR",
    )
    const unit = generateHmiUnit({
      ...project,
      screens: [project.screens[0], { ...project.screens[1], source: screen }],
      installedLibraries: installed,
    })
    expect(unit.ok).toBe(false)
    expect(unit.errors.map((e) => e.message)).toEqual([
      'HMIVENDORDIAL (library extra-widgets) needs vendor_api.h, which this build does not provide',
    ])
  })

  it('keeps the first library of a name, and the first widget of a name across libraries', () => {
    const twice = loadHmiWidgetLibraries([...installedWidgetArchives(), ...installedWidgetArchives()])
    expect(twice.libraries.map((l) => l.name)).toEqual(['hmi-alarms', 'standard-widgets'])
    const shadow = JSON.parse(
      JSON.stringify(extraWidgetLibrary()).replaceAll('"hmi_palette","value":"Gauges"', '"hmi_palette","value":"X"'),
    )
    const first = loadHmiWidgetLibraries([...installedWidgetArchives(), extraWidgetLibrary(), shadow])
    expect(first.catalog.widgets.get('HMIDIAL')?.palette).toBe('Gauges')
  })

  it('reloads the libraries for the palette when one is installed', async () => {
    let installed: unknown[] = installedWidgetArchives()
    let changed: () => void = () => undefined
    const mechanisms: HmiPreviewMechanisms = {
      readHmiSources: () => Promise.resolve({ root: '', files: {} }),
      readStrucppRuntimeHeaders: () => Promise.resolve({}),
      compileToWasm: () => Promise.reject(new Error('not compiled here')),
      holdToolchain: () => Promise.resolve(),
      startWorker: () => {
        throw new Error('no worker')
      },
      loadLibraries: () => Promise.resolve(installed),
      onLibrariesChanged: (listener) => {
        changed = listener
        return () => undefined
      },
    }
    const port = createHmiPreviewPort(mechanisms)
    expect((await port.catalog([])).catalog.widgets.has('HMIDIAL')).toBe(false)
    installed = [...installed, extraWidgetLibrary()]
    changed()
    expect((await port.catalog([])).catalog.widgets.get('HMIDIAL')?.library).toBe('extra-widgets')
    const context = await port.codeContext({ screens: [], settings: sampleProject().settings })
    expect(context.libraries.map((l) => l.name)).toEqual(['hmi-alarms', 'standard-widgets', 'extra-widgets'])
    expect(context.screenMembers).toContain('ONSHOW')
  })
})

/** Every non-test TypeScript file under `dir`. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return entry === '__tests__' ? [] : sourceFiles(path)
    return /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry) ? [path] : []
  })
}

describe('HMI library sources', () => {
  it('are no longer compiled at run time: the only HMI compileStlib is the project widget blocks', () => {
    const files = ['src/backend', 'src/middleware', 'src/frontend', 'src/main', 'src/cli']
      .map((dir) => join(process.cwd(), dir))
      .filter((dir) => statSync(dir, { throwIfNoEntry: false })?.isDirectory() === true)
      .flatMap(sourceFiles)
      .map((file) => ({ file: file.slice(process.cwd().length + 1), text: readFileSync(file, 'utf8') }))
    const compiling = files.filter((f) => /compileStlib\(/.test(f.text))
    expect(compiling.filter((f) => /['"](standard-widgets|hmi-alarms)['"]/.test(f.text)).map((f) => f.file)).toEqual([])
    expect(compiling.filter((f) => f.file.includes('/hmi/')).map((f) => f.file)).toEqual([
      'src/backend/shared/hmi/unit/generate-hmi-unit.ts',
    ])
    const unit = files.find((f) => f.file === 'src/backend/shared/hmi/unit/generate-hmi-unit.ts')?.text ?? ''
    expect(unit.match(/compileStlib\(/g)).toHaveLength(1)
    expect(unit).toMatch(/compileStlib\(\s*widgets\.map[\s\S]{0,200}name: PROJECT_WIDGETS/)
    for (const removed of ['STANDARD_WIDGETS_SOURCES', 'HMI_ALARMS_ST', 'buildStandardWidgets', 'buildHmiAlarms'])
      expect(files.filter((f) => f.text.includes(removed)).map((f) => f.file)).toEqual([])
  })
})
