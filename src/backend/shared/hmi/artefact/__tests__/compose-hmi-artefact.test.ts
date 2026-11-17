import { existsSync, readdirSync, readFileSync } from 'fs'
import { join } from 'path'

import type { WasmCompileRequest, WasmCompileResult } from '../../../../../middleware/shared/ports/wasm-toolchain-types'
import { sampleProject } from '../../unit/__tests__/fixtures/sample-project'
import {
  composeHmiArtefact,
  type ComposeHmiArtefactInput,
  HMI_CLIENT_C_FLAGS,
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
const stats = { units: 1, cached: 0, compileMs: 1, linkMs: 1 }
const WASM = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])

const LEAVES = [
  ['INSTANCE0.LEVEL', 0, 3],
  ['INSTANCE0.RUNNING', 0, 4],
  ['INSTANCE0.SPEED', 0, 5],
  ['INSTANCE0.TAG', 1, 0],
  ['ALARMON', 2, 0],
].map(([path, arrayIdx, elemIdx]) => ({ path, arrayIdx, elemIdx, type: 'BOOL', size: 1 }))

function input(overrides: Partial<ComposeHmiArtefactInput> = {}) {
  const requests: WasmCompileRequest[] = []
  const result: WasmCompileResult = { ok: true, wasm: WASM, stats, diagnostics: [] }
  const value: ComposeHmiArtefactInput = {
    sources: sampleProject(),
    plcArchives: [],
    debugMapJson: JSON.stringify({ version: 2, md5: 'x', leaves: LEAVES }),
    md5: 'fe3845fc1babc413455ceb7a5ee596bf',
    instances: [{ name: 'instance0', program: 'Main' }],
    hmiSources: HMI_SOURCES,
    compile: (request) => {
      requests.push(request)
      return Promise.resolve(result)
    },
    ...overrides,
  }
  return { value, requests }
}

describe('composeHmiArtefact', () => {
  it('builds hmi/ with the unit, the core, the font table, the client and the manifest', async () => {
    const { value, requests } = input()
    const result = await composeHmiArtefact(value)
    if (!result.ok) throw new Error(JSON.stringify(result.errors))
    const { files } = result
    expect(files['hmi/manifest.json']).toBe(HMI_INSTALL_MANIFEST)
    expect(files['hmi/src/hmi_unit_glue.cpp']).toContain(
      'const char hmi_plc_md5[] = "fe3845fc1babc413455ceb7a5ee596bf";',
    )
    expect(files['hmi/src/hmi_unit_glue.cpp']).toContain('{2u, 0u, 1, 0, "CONFIG0.ALARMON"},')
    expect(files['hmi/src/hmi_unit.h']).toContain('hmi_tag_access_t')
    expect(files['hmi/src/hmi_fonts.c']).toContain('hmi_font_table')
    expect(files['hmi/src/core/hmi_core.c']).toBeDefined()
    expect(files['hmi/src/core/third_party/stb_truetype.h']).toBeDefined()
    expect(files['hmi/client/hmi_client.wasm']).toBe(WASM)
    expect(String(files['hmi/client/fonts-LICENSE.txt'])).toContain('SIL OPEN FONT LICENSE')
    expect(String(files['hmi/client/socket.io-LICENSE.txt'])).toContain('MIT')
    for (const name of ['index.html', 'hmi.css', 'hmi-client.js', 'socket.io.min.js'])
      expect(typeof files[`hmi/client/${name}`]).toBe('string')
    expect(Object.keys(files).filter((p) => p.startsWith('hmi/src/preview') || p.includes('hmi_preview'))).toEqual([])
    expect(result.tags.map((t) => t.address)).toEqual([
      { arr: 0, elem: 3 },
      { arr: 0, elem: 4 },
      { arr: 0, elem: 5 },
      { arr: 1, elem: 0 },
      { arr: 2, elem: 0 },
    ])

    expect(requests).toHaveLength(1)
    const request = requests[0]
    expect(request.output).toBe('hmi_client.wasm')
    expect(request.cFlags).toEqual(HMI_CLIENT_C_FLAGS)
    expect(request.units.map((u) => u.source)).toEqual([
      'core/hmi_raster.c',
      'core/hmi_text.c',
      'core/hmi_math.c',
      'client/hmi_fonts.c',
      'client/hmi_client.c',
    ])
    expect(request.files['client/hmi_fonts.c']).toBe(files['hmi/src/hmi_fonts.c'])
  })

  it('sends only the removal manifest for a project without screens', async () => {
    const { value, requests } = input({ sources: null })
    const result = await composeHmiArtefact(value)
    expect(result).toEqual({ ok: true, files: { 'hmi/manifest.json': HMI_REMOVE_MANIFEST }, tags: [], warnings: [] })
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

  it.each(['client/hmi-client.js', 'client/hmi_client.c', 'unit/hmi_unit.h', 'fonts/LICENSE.txt'])(
    'names a missing %s',
    async (missing) => {
      const hmiSources = { ...HMI_SOURCES }
      delete hmiSources[missing]
      const result = await composeHmiArtefact(input({ hmiSources }).value)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.errors[0].message).toContain(missing)
    },
  )

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
        { message: 'hmi_client.c:3: error: oops', level: 'error' },
        { message: 'a warning', level: 'warning' },
      ],
    }
    const result = await composeHmiArtefact(input({ compile: () => Promise.resolve(failed) }).value)
    expect(result.ok).toBe(false)
    if (!result.ok)
      expect(result.errors[0].message).toBe('The HMI browser client did not compile: hmi_client.c:3: error: oops')
    const bare: WasmCompileResult = { ok: false, error: 'link failed', stats, diagnostics: [] }
    const second = await composeHmiArtefact(input({ compile: () => Promise.resolve(bare) }).value)
    if (!second.ok) expect(second.errors[0].message).toBe('The HMI browser client did not compile: link failed')
  })

  it('accepts sources given as text', async () => {
    const decoder = new TextDecoder()
    const hmiSources: Record<string, string | Uint8Array> = {}
    for (const [path, content] of Object.entries(HMI_SOURCES))
      hmiSources[path] = path.endsWith('.ttf') ? content : decoder.decode(content)
    const result = await composeHmiArtefact(input({ hmiSources }).value)
    expect(result.ok).toBe(true)
  })
})
