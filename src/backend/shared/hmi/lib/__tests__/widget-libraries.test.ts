import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import type { HmiPreviewMechanisms } from '../../../../../middleware/shared/ports/hmi-preview-mechanisms'
import { HMI_CORE_API_VERSION } from '../../../../../middleware/shared/utils/hmi/widget-libraries'
import { loadStrucpp } from '../../../library/strucpp-runtime'
import { createHmiPreviewPort } from '../../preview/hmi-preview-port'
import { installedArchiveText, installedWidgetArchives } from '../../unit/__tests__/fixtures/widget-libraries'
import { buildHmiWidgetCatalog, generateHmiUnit } from '../../unit/generate-hmi-unit'
import { sampleProject } from '../../unit/__tests__/fixtures/sample-project'
import { buildWidgetCatalog } from '../widget-catalog'
import { loadHmiWidgetLibraries, mergeWidgetCatalogs, plcLibraryArchives } from '../widget-libraries'

/** A user widget library: one widget on top of standard-widgets, with the metadata a widget library release carries. */
function extraWidgetLibrary(hmiCoreApi = HMI_CORE_API_VERSION): object {
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
`,
      },
    ],
    {
      name: 'extra-widgets',
      version: '1.0.0',
      namespace: 'extra_widgets',
      headers: ['hmi_core.h'],
      dependencies: [base],
    },
  )
  if (compiled.errors.length > 0) throw new Error(compiled.errors.map((e) => e.message).join('\n'))
  const full = buildWidgetCatalog([base.manifest, compiled.archive.manifest])
  const widgets = [...full.widgets.values()].filter((w) => w.library === 'extra-widgets')
  return {
    ...compiled.archive,
    openplc: {
      formatVersion: 1,
      kind: 'hmi',
      license: 'GPL-3.0-only',
      hmiCoreApi,
      catalog: { widgets, colors: [] },
    },
  }
}

describe('installed widget libraries', () => {
  it('loads the pre-installed widget library and leaves the PLC libraries to the PLC build', () => {
    const installed = installedWidgetArchives()
    const { libraries, errors } = loadHmiWidgetLibraries(installed)
    expect(errors).toEqual([])
    expect(libraries.map((l) => l.name)).toEqual(['standard-widgets'])
    expect(libraries[0].catalog.widgets.get('HMIBUTTON')?.palette).toBe('Controls')
    expect(plcLibraryArchives(installed).map((a) => a.manifest.name)).toEqual(['hmi-alarms'])
  })

  it('says how to recover when no widget library is installed', () => {
    expect(loadHmiWidgetLibraries([]).errors).toEqual([
      { file: 'HMI', message: expect.stringContaining('No HMI widget library is installed') },
    ])
  })

  it('refuses a widget library built for another HMI core API, with the reason, and keeps the others', () => {
    const { libraries, errors } = loadHmiWidgetLibraries([
      ...installedWidgetArchives(),
      extraWidgetLibrary(HMI_CORE_API_VERSION + 1),
    ])
    expect(libraries.map((l) => l.name)).toEqual(['standard-widgets'])
    expect(errors).toEqual([
      {
        file: 'HMI',
        message:
          `The widget library "extra-widgets" is built for HMI core API ${HMI_CORE_API_VERSION + 1}, but this editor ` +
          `provides HMI core API ${HMI_CORE_API_VERSION}. Install a build of the library for HMI core API ` +
          `${HMI_CORE_API_VERSION}.`,
      },
    ])
    const unit = generateHmiUnit({
      ...sampleProject(),
      widgetLibraries: [...installedWidgetArchives(), extraWidgetLibrary(9)],
    })
    expect(unit.ok).toBe(false)
    expect(unit.errors[0].message).toContain('is built for HMI core API 9')
  })

  it('puts the widgets of an installed widget library in the catalogue, and builds screens that use them', () => {
    const installed = [...installedWidgetArchives(), extraWidgetLibrary()]
    const { catalog, errors } = buildHmiWidgetCatalog([], installed)
    expect(errors).toEqual([])
    expect(catalog.widgets.get('HMIDIAL')).toMatchObject({ library: 'extra-widgets', palette: 'Gauges' })
    expect(catalog.widgets.get('HMIDIAL')?.properties.find((p) => p.name === 'Sweep')).toMatchObject({
      defaultValue: '270',
    })
    const project = sampleProject()
    const screen = project.screens[1].source.replace('END_VAR', "  Dial : HmiDial := (Parent := 'Body');\nEND_VAR")
    const unit = generateHmiUnit({
      ...project,
      screens: [project.screens[0], { ...project.screens[1], source: screen }],
      widgetLibraries: installed,
    })
    expect(unit.errors).toEqual([])
    expect(Object.keys(unit.files)).toContain('lib_extra_widgets.cpp')
  })

  it('keeps the first library of a name, and the first widget of a name across libraries', () => {
    const [first] = loadHmiWidgetLibraries(installedWidgetArchives()).libraries
    const twice = loadHmiWidgetLibraries([...installedWidgetArchives(), ...installedWidgetArchives()])
    expect(twice.libraries).toHaveLength(1)
    const other = {
      widgets: new Map([['HMIBUTTON', { ...first.catalog.widgets.get('HMIBUTTON'), palette: 'X' }]]),
      colors: [],
    }
    const merged = mergeWidgetCatalogs([first.catalog, other as typeof first.catalog])
    expect(merged.widgets.get('HMIBUTTON')?.palette).toBe('Controls')
    expect(merged.colors).toEqual(first.catalog.colors)
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
    expect(context.libraries.map((l) => l.name)).toEqual(['standard-widgets', 'extra-widgets'])
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
