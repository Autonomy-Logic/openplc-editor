/** @jest-environment node */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { WasmCompileRequest, WasmCompileResult } from '../../../../../middleware/shared/ports/wasm-toolchain-types'
import { composeHmiArtefact } from '../../artefact/compose-hmi-artefact'
import { buildHmiPreview, type HmiPreviewResources } from '../../preview/build-hmi-preview'
import { sampleProject } from '../../unit/__tests__/fixtures/sample-project'
import { hmiWidgetLibraryArchives } from '../widget-libraries'
import { HMI_LIBRARY_CXX_FLAGS, hmiLibraryUnit, libraryOfFile, shareLibraryUnits } from '../library-unit'

/* The bundled HMI sources: resources/sources/hmi in the editor, src/assets/firmware/hmi on the web. */
const HMI_DIR =
  ['resources/sources/hmi', 'src/assets/firmware/hmi']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-hmi-sources'
const LIBS = join(process.cwd(), 'node_modules', 'strucpp', 'libs')
const plcLibrary = (name: string) => ({ name, archiveJson: readFileSync(join(LIBS, `${name}.stlib`), 'utf-8') })

function readAll(dir: string, prefix = ''): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(out, readAll(path, `${prefix}${entry.name}/`))
    else out[`${prefix}${entry.name}`] = new Uint8Array(readFileSync(path))
  }
  return out
}

const resources: HmiPreviewResources = {
  runtimeHeaders: { 'iec_types.hpp': '// types' },
  hmiSources: { 'core/hmi_core.c': '// core', 'preview/hmi_preview_host.cpp': '// host' },
  readFont: (file) => Promise.resolve(new Uint8Array(readFileSync(join(HMI_DIR, 'fonts', file)))),
}

const EXTRA = `FUNCTION_BLOCK Extra EXTENDS HmiLamp
END_FUNCTION_BLOCK
`
const LEAVES = [
  ['INSTANCE0.LEVEL', 0, 3],
  ['INSTANCE0.RUNNING', 0, 4],
  ['INSTANCE0.SPEED', 0, 5],
  ['INSTANCE0.TAG', 1, 0],
  ['ALARMON', 2, 0],
].map(([path, arrayIdx, elemIdx]) => ({ path, arrayIdx, elemIdx, type: 'BOOL', size: 1 }))
const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])
const done: WasmCompileResult = {
  ok: true,
  wasm: WASM,
  stats: { units: 1, cached: 0, compileMs: 0, linkMs: 0 },
  diagnostics: [],
}

async function previewRequest(project = sampleProject()): Promise<WasmCompileRequest> {
  const requests: WasmCompileRequest[] = []
  const build = await buildHmiPreview(project, resources, (request) => {
    requests.push(request)
    return Promise.resolve(done)
  })
  if (!build.ok) throw new Error(JSON.stringify(build.errors))
  return requests[0]
}

/** The library units of a request: their files and how each compiles. */
function libraryPart(request: WasmCompileRequest) {
  const units = request.units.filter((u) => u.source.startsWith('hmilib/'))
  const files = Object.fromEntries(Object.entries(request.files).filter(([path]) => path.startsWith('hmilib/')))
  return { units, files }
}

describe('widget library units', () => {
  it('generates the library from its archive alone, whole, with its own declarations only', () => {
    const [archive] = hmiWidgetLibraryArchives()
    const built = hmiLibraryUnit(archive)
    if (!built.ok) throw new Error(built.error)
    const { unit, files } = built.unit
    expect(unit).toEqual({
      source: 'hmilib/standard-widgets/library.cpp',
      language: 'c++',
      flags: [...HMI_LIBRARY_CXX_FLAGS],
      ownFlags: true,
    })
    const header = files['hmilib/standard-widgets/hmi_lib_libraries.hpp']
    expect(header).toContain('// Library: standard-widgets')
    expect(header).not.toMatch(/STRING_LENGTH|LIST_LENGTH|Library: project-widgets/)
    expect(libraryOfFile('lib_standard_widgets.cpp', files[unit.source])).toBe('standard-widgets')
    expect(hmiLibraryUnit(archive)).toBe(built)
  })

  it('gives the same library unit to projects with different PLC libraries and widget blocks', async () => {
    const plain = await previewRequest()
    const project = sampleProject()
    const withLibraries = await previewRequest({
      ...project,
      widgets: [...project.widgets, { name: 'Extra', source: EXTRA }],
      plcLibraries: ['iec-standard-fb', 'oscat-basic'].map(plcLibrary),
    })
    expect(libraryPart(plain).units).toHaveLength(1)
    expect(libraryPart(withLibraries)).toEqual(libraryPart(plain))
    expect(withLibraries.files['unit/hmi_preview_pch.hpp']).toBe(plain.files['unit/hmi_preview_pch.hpp'])
    expect(Object.values(plain.files).some((f) => typeof f === 'string' && f.includes('STRING_LENGTH'))).toBe(false)
    expect(Object.values(withLibraries.files).some((f) => typeof f === 'string' && f.includes('STRING_LENGTH'))).toBe(
      true,
    )
  })

  it('takes the library code out of the generated unit, keeping the widget blocks of the project', async () => {
    const request = await previewRequest()
    expect(Object.keys(request.files)).not.toContain('unit/lib_standard_widgets.cpp')
    expect(Object.keys(request.files)).toContain('unit/lib_project_widgets.cpp')
    expect(request.files).not.toHaveProperty(['groups/library.cpp'])
  })

  it('compiles the library unit alike in the preview and the Runtime v4 build', async () => {
    const requests: WasmCompileRequest[] = []
    const result = await composeHmiArtefact({
      sources: sampleProject(),
      plcArchives: [],
      capabilities: {},
      debugMapJson: JSON.stringify({ version: 2, md5: 'x', leaves: LEAVES }),
      md5: 'fe3845fc1babc413455ceb7a5ee596bf',
      instances: [{ name: 'instance0', program: 'Main' }],
      hmiSources: readAll(HMI_DIR),
      runtimeHeaders: { 'strucpp_runtime/include/iec_types.hpp': '#pragma once\n' },
      compile: (request) => {
        requests.push(request)
        return Promise.resolve(done)
      },
    })
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    expect(libraryPart(requests[0])).toEqual(libraryPart(await previewRequest()))
    expect(requests[0].units.map((u) => u.source)).not.toContain('unit/lib_standard_widgets.cpp')
  })

  it('refuses nothing it does not share: files of other libraries stay in the unit', () => {
    const files = {
      'lib_other.cpp': '// Generated by STruC++\n// Library: other\n',
      'pou_MAIN.cpp': '// Library: standard-widgets\n',
    }
    const shared = shareLibraryUnits(files, hmiWidgetLibraryArchives())
    expect(shared.ok && shared.unitFiles).toEqual(files)
  })
})
