import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import type { WasmCompileRequest, WasmCompileResult } from '../../../../../middleware/shared/ports/wasm-toolchain-types'
import { sampleProject } from '../../unit/__tests__/fixtures/sample-project'
import {
  composeHmiArtefact,
  type ComposeHmiArtefactInput,
  HMI_CLIENT_C_FLAGS,
  HMI_CLIENT_CXX_FLAGS,
  HMI_INSTALL_MANIFEST,
  HMI_REMOVE_MANIFEST,
  hmiRemovalArtefact,
} from '../compose-hmi-artefact'

/* The bundled HMI sources: resources/sources/hmi in the editor, src/assets/firmware/hmi on the web. */
const HMI_DIR =
  ['resources/sources/hmi', 'src/assets/firmware/hmi']
    .map((dir) => join(process.cwd(), dir))
    .find((dir) => existsSync(dir)) ?? 'missing-hmi-sources'

function readAll(dir: string, prefix = ''): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(out, readAll(path, `${prefix}${entry.name}/`))
    else out[`${prefix}${entry.name}`] = new Uint8Array(readFileSync(path))
  }
  return out
}

const HMI_SOURCES = readAll(HMI_DIR)
const RUNTIME_HEADERS = { 'strucpp_runtime/include/iec_types.hpp': '#pragma once\n' }
const stats = { units: 1, cached: 0, compileMs: 1, linkMs: 1 }
const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])

const LEAVES = [
  ['INSTANCE0.LEVEL', 0, 3],
  ['INSTANCE0.RUNNING', 0, 4],
  ['INSTANCE0.SPEED', 0, 5],
  ['INSTANCE0.TAG', 1, 0],
  ['ALARMON', 2, 0],
].map(([path, arrayIdx, elemIdx]) => ({ path, arrayIdx, elemIdx, type: 'BOOL', size: 1 }))

const LIST_SCREEN = `FUNCTION_BLOCK Overview EXTENDS HmiScreen
  VAR
    Body : HmiHorizontalStack;
    List : HmiAlarmList := (Parent := 'Body');
  END_VAR
END_FUNCTION_BLOCK
`

function input(overrides: Partial<ComposeHmiArtefactInput> = {}) {
  const requests: WasmCompileRequest[] = []
  const result: WasmCompileResult = { ok: true, wasm: WASM, stats, diagnostics: [] }
  const value: ComposeHmiArtefactInput = {
    sources: sampleProject(),
    plcArchives: [],
    capabilities: {},
    debugMapJson: JSON.stringify({ version: 2, md5: 'x', leaves: LEAVES }),
    md5: 'fe3845fc1babc413455ceb7a5ee596bf',
    instances: [{ name: 'instance0', program: 'Main' }],
    hmiSources: HMI_SOURCES,
    runtimeHeaders: RUNTIME_HEADERS,
    compile: (request) => {
      requests.push(request)
      return Promise.resolve(result)
    },
    ...overrides,
  }
  return { value, requests }
}

describe('composeHmiArtefact', () => {
  it('builds hmi/ with the host-side manifest for the device and the whole HMI as WebAssembly for the browser', async () => {
    const { value, requests } = input()
    const result = await composeHmiArtefact(value)
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    const { files } = result
    expect(files['hmi/manifest.json']).toBe(HMI_INSTALL_MANIFEST)
    expect(HMI_INSTALL_MANIFEST).toBe('{"format": 2}\n')
    expect(Object.keys(files).filter((p) => p.startsWith('hmi/src/'))).toEqual([
      'hmi/src/hmi_access.h',
      'hmi/src/hmi_access.c',
    ])
    const access = String(files['hmi/src/hmi_access.c'])
    expect(access).toContain('const char hmi_access_plc_md5[] = "fe3845fc1babc413455ceb7a5ee596bf";')
    expect(access).toContain('{2u, 0u, 1, 0, "CONFIG0.ALARMON"},')
    expect(access).toContain('const uint32_t hmi_access_period_ms = 50u;')
    expect(String(files['hmi/src/hmi_access.h'])).toContain('hmi_access_page_t')
    expect(files['hmi/client/hmi.wasm']).toBe(WASM)
    expect(String(files['hmi/client/fonts-LICENSE.txt'])).toContain('SIL OPEN FONT LICENSE')
    expect(String(files['hmi/client/socket.io-LICENSE.txt'])).toContain('MIT')
    for (const name of ['index.html', 'hmi.css', 'hmi-client.js', 'socket.io.min.js'])
      expect(typeof files[`hmi/client/${name}`]).toBe('string')
    expect(Object.keys(files).some((p) => /\.(cpp|hpp)$/.test(p) || p.includes('hmi_preview'))).toBe(false)
    expect(result.tags.map((t) => t.address)).toEqual([
      { arr: 0, elem: 3 },
      { arr: 0, elem: 4 },
      { arr: 0, elem: 5 },
      { arr: 1, elem: 0 },
      { arr: 2, elem: 0 },
    ])
    expect(result.pages).toEqual([
      {
        name: 'Overview',
        reads: [0, 1, 2, 3, 4],
        writes: [1, 2, 3].map((tag) => expect.objectContaining({ tag, whole: true, bits: [] })),
        roles: 15,
      },
      { name: 'Details', reads: [3], writes: [], roles: 3 },
    ])

    expect(requests).toHaveLength(1)
    const request = requests[0]
    expect(request.output).toBe('hmi.wasm')
    expect(request.cFlags).toEqual(HMI_CLIENT_C_FLAGS)
    expect(request.cxxFlags).toEqual(HMI_CLIENT_CXX_FLAGS)
    expect(HMI_CLIENT_C_FLAGS).toEqual(expect.arrayContaining(['-O2', '-ffp-contract=off']))
    const sources = request.units.map((u) => u.source)
    expect(sources.slice(0, 6)).toEqual([
      'hmi/core/hmi_core.c',
      'hmi/core/hmi_theme.c',
      'hmi/core/hmi_math.c',
      'hmi/core/hmi_raster.c',
      'hmi/core/hmi_text.c',
      'unit/hmi_fonts.c',
    ])
    expect(sources).toEqual(
      expect.arrayContaining(['unit/hmi_unit_glue.cpp', 'unit/pou_OVERVIEW.cpp', 'hmi/client/hmi_browser_host.cpp']),
    )
    expect(sources.some((s) => s.includes('preview'))).toBe(false)
    expect(request.files['strucpp_runtime/include/iec_types.hpp']).toBe('#pragma once\n')
    expect(request.files['unit/hmi_unit_glue.cpp']).toContain(
      'const char hmi_plc_md5[] = "fe3845fc1babc413455ceb7a5ee596bf";',
    )
  })

  it('leaves the panel PIN, relock time and calibration out of everything a Runtime v4 upload carries', async () => {
    const sources = sampleProject()
    sources.settings = {
      ...sources.settings,
      pin: { enabled: true, value: '97531864' },
      relock: { mode: 'idle', minutes: 47 },
    }
    const { value, requests } = input({ sources })
    const result = await composeHmiArtefact(value)
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    const decoder = new TextDecoder()
    const texts = [
      ...Object.values(result.files).map((f) => (typeof f === 'string' ? f : decoder.decode(f))),
      ...Object.entries(requests[0].files)
        .filter(([path]) => !path.endsWith('hmi_fonts.c'))
        .map(([, f]) => f),
    ]
    for (const text of texts) {
      expect(text).not.toContain('97531864')
      expect(text).not.toMatch(
        /hmi_panel_pin\s*\[\]\s*=|hmi_relock_minutes\s*=|hmi_touch_cal_mode\s*=|hmi_build_id\s*\[\]\s*=/,
      )
    }
  })

  it('sends only the removal manifest for a project without screens', async () => {
    const { value, requests } = input({ sources: null })
    const result = await composeHmiArtefact(value)
    expect(result).toEqual({
      ok: true,
      files: { 'hmi/manifest.json': HMI_REMOVE_MANIFEST },
      tags: [],
      pages: [],
      warnings: [],
    })
    expect(hmiRemovalArtefact()).toEqual({ 'hmi/manifest.json': HMI_REMOVE_MANIFEST })
    expect(requests).toHaveLength(0)
  })

  it('refuses a screen variable the compiled program has no debug address for', async () => {
    const leaves = LEAVES.filter((l) => l.path !== 'ALARMON')
    const { value } = input({ debugMapJson: JSON.stringify({ leaves }) })
    const result = await composeHmiArtefact(value)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.map((e) => e.message)).toEqual([
      'AlarmOn has no debug address in the compiled PLC program, so the HMI cannot reach it',
    ])
  })

  it('passes the generator errors through', async () => {
    const sources = sampleProject()
    sources.screens = [
      { name: 'Overview', source: 'FUNCTION_BLOCK Overview EXTENDS HmiScreen\n  x := ;\nEND_FUNCTION_BLOCK\n' },
    ]
    const { value, requests } = input({ sources })
    const result = await composeHmiArtefact(value)
    expect(result.ok).toBe(false)
    expect(requests).toHaveLength(0)
  })

  it.each([
    'client/hmi-client.js',
    'client/hmi_browser_host.cpp',
    'unit/hmi_unit.h',
    'unit/hmi_access.h',
    'fonts/LICENSE.txt',
  ])('names a missing %s', async (missing) => {
    const hmiSources = { ...HMI_SOURCES }
    delete hmiSources[missing]
    const result = await composeHmiArtefact(input({ hmiSources }).value)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].message).toContain(missing)
  })

  it('fails without the core or a font', async () => {
    const noCore = Object.fromEntries(Object.entries(HMI_SOURCES).filter(([p]) => !p.startsWith('core/')))
    expect((await composeHmiArtefact(input({ hmiSources: noCore }).value)).ok).toBe(false)
    const noFonts = Object.fromEntries(Object.entries(HMI_SOURCES).filter(([p]) => !p.endsWith('.ttf')))
    const result = await composeHmiArtefact(input({ hmiSources: noFonts }).value)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0].message).toMatch(/is not bundled/)
  })

  it('reports the compiler errors when the client module does not build', async () => {
    const failed: WasmCompileResult = {
      ok: false,
      error: 'link failed',
      stats,
      diagnostics: [
        { message: 'hmi_browser_host.cpp:3: error: oops', level: 'error' },
        { message: 'a warning', level: 'warning' },
      ],
    }
    const result = await composeHmiArtefact(input({ compile: () => Promise.resolve(failed) }).value)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors[0].message).toBe(
        'The HMI browser module did not compile: hmi_browser_host.cpp:3: error: oops',
      )
    const bare: WasmCompileResult = { ok: false, error: 'link failed', stats, diagnostics: [] }
    const second = await composeHmiArtefact(input({ compile: () => Promise.resolve(bare) }).value)
    if (!second.ok) expect(second.errors[0].message).toBe('The HMI browser module did not compile: link failed')
  })

  it('accepts sources given as text', async () => {
    const decoder = new TextDecoder()
    const hmiSources: Record<string, string | Uint8Array> = {}
    for (const [path, content] of Object.entries(HMI_SOURCES))
      hmiSources[path] = path.endsWith('.ttf') ? content : decoder.decode(content)
    const result = await composeHmiArtefact(input({ hmiSources }).value)
    expect(result.ok).toBe(true)
  })

  it('refuses a widget the target lacks the capability for, and builds it on a target that has it', async () => {
    const project = sampleProject()
    const sources = { ...project, screens: [{ name: 'Overview', source: LIST_SCREEN }, project.screens[1]] }
    const refused = await composeHmiArtefact(input({ sources, capabilities: { hmiDataWidgets: false } }).value)
    if (refused.ok) throw new Error('the list was built for a target without hmiDataWidgets')
    expect(refused.errors.map((e) => e.message)).toEqual([
      'List: HmiAlarmList needs a target with hmiDataWidgets, and the selected board does not have it',
    ])
    const built = await composeHmiArtefact(input({ sources, capabilities: { hmiDataWidgets: true } }).value)
    if (!built.ok) throw new Error(JSON.stringify(built.errors))
  })
})
