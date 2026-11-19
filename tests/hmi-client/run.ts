/**
 * The HMI artefact of a Runtime v4 upload, outside the app: composes the sample project's `hmi/` folder with the real
 * WebAssembly clang and drives the browser module (`hmi.wasm`: unit, core, fonts and browser host) as hmi-client.js
 * does: values in, screen frames, taps and the writes they queue, the write count that holds back stale values, the
 * read and write lists of the host-side manifest, and the same pixels as the same sources built natively.
 *
 *   npx ts-node -T -r tsconfig-paths/register tests/hmi-client/run.ts
 *
 * HMI_CLIENT_CXX names the native C++ compiler (default c++), HMI_CLIENT_CC the C compiler (default cc).
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  composeHmiArtefact,
  HMI_CLIENT_MODULE,
  HMI_INSTALL_MANIFEST,
} from '../../src/backend/shared/hmi/artefact/compose-hmi-artefact'
import { generateHmiUnit } from '../../src/backend/shared/hmi/unit/generate-hmi-unit'
import { sampleProject } from '../../src/backend/shared/hmi/unit/__tests__/fixtures/sample-project'
import { isYowaspClang, runClangJob } from '../../src/backend/shared/wasm-toolchain/clang-worker-host'
import { type CachedWasmObject, compileToWasm } from '../../src/backend/shared/wasm-toolchain/compile-to-wasm'
import type { WasmClangRunner } from '../../src/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmCompileRequest } from '../../src/middleware/shared/ports/wasm-toolchain-types'

const ROOT = join(__dirname, '..', '..')
const HMI = join(ROOT, 'resources', 'sources', 'hmi')
const RUNTIME = join(ROOT, 'node_modules', 'strucpp', 'src', 'runtime', 'include')
const CXX = process.env.HMI_CLIENT_CXX ?? 'c++'
const CC = process.env.HMI_CLIENT_CC ?? 'cc'
const MD5 = '0123456789abcdef0123456789abcdef'
const OPERATOR = 2
const VIEWER = 3

const failures: string[] = []
const check = (ok: boolean, what: string): void => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${what}`)
  if (!ok) failures.push(what)
}

function readAll(dir: string, prefix = ''): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {}
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) Object.assign(out, readAll(path, `${prefix}${entry.name}/`))
    else out[`${prefix}${entry.name}`] = new Uint8Array(readFileSync(path))
  }
  return out
}

function runtimeHeaders(): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of readdirSync(RUNTIME))
    out[`strucpp_runtime/include/${name}`] = readFileSync(join(RUNTIME, name), 'utf8')
  return out
}

async function runner(): Promise<WasmClangRunner> {
  const clang: unknown = await import('@yowasp/clang')
  if (!isYowaspClang(clang)) throw new Error('@yowasp/clang is not the expected module')
  return {
    concurrency: Math.max(1, Math.min(4, cpus().length - 1)),
    prepare: () => Promise.resolve(),
    run: (job) => runClangJob(clang, job.argv, job.tree),
  }
}

/** FNV-1a over the bytes, as the native driver prints it. */
function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

/** A VALUES payload as the runtime sends it: `u16 page, u32 writes, u16 count` and `u16 tag, u16 len, bytes`. */
function values(page: number, writes: number, records: Array<[number, number[]]>): Uint8Array {
  const out: number[] = []
  const u16 = (v: number) => out.push(v & 0xff, (v >> 8) & 0xff)
  u16(page)
  u16(writes & 0xffff)
  u16(writes >>> 16)
  u16(records.length)
  for (const [tag, bytes] of records) {
    u16(tag)
    u16(bytes.length)
    out.push(...bytes)
  }
  return new Uint8Array(out)
}

const f32 = (v: number): number[] => [...new Uint8Array(new Float32Array([v]).buffer)]
const text = (s: string): number[] => [...new TextEncoder().encode(s)]

/** The scripted session both builds run: [what, args] steps, one frame of 100 ms after each. */
const SCRIPT: ReadonlyArray<{ values?: Uint8Array; tap?: string }> = [
  {
    values: values(0, 0, [
      [0, f32(6.5)],
      [1, [1]],
      [2, [40, 0]],
      [3, text('Pump A')],
      [4, [1]],
    ]),
  },
  { tap: 'RUN' },
  {},
  {
    values: values(0, 1, [
      [1, [0]],
      [0, f32(7.25)],
    ]),
  },
]

/** The native driver: runs SCRIPT on the browser host built natively and prints a pixel hash per step. */
function nativeDriver(script: typeof SCRIPT, ids: Record<string, number>): string {
  const steps = script
    .map((step, i) => {
      const lines: string[] = []
      if (step.values) {
        lines.push(
          `{ static const uint8_t v[] = {${[...step.values].join(',')}}; uint8_t *in = hmi_bh_in(${step.values.length}); memcpy(in, v, sizeof v); hmi_bh_values(${step.values.length}); }`,
        )
      }
      if (step.tap) lines.push(`tap(${ids[step.tap]}, ${i * 100 + 50});`)
      lines.push(`hmi_bh_frame(${(i + 1) * 100}); render_hash();`)
      return lines.join('\n    ')
    })
    .join('\n    ')
  return `#include <stdint.h>
#include <stdio.h>
#include <string.h>
extern "C" {
int32_t hmi_bh_init(int32_t, int32_t, int32_t);
uint32_t hmi_bh_frame(uint32_t);
uint8_t *hmi_bh_render(int32_t, int32_t, int32_t);
uint8_t *hmi_bh_in(uint32_t);
int32_t hmi_bh_values(uint32_t);
void hmi_bh_pointer(int32_t, int32_t, int32_t);
int32_t hmi_bh_bounds_count(void);
const int32_t *hmi_bh_bounds(void);
}
static void render_hash() {
    for (int scale = 1; scale <= 2; scale++) {
        const int w = 480 * scale, h = 320 * scale;
        uint8_t *p = hmi_bh_render(w, h, 256 * scale);
        unsigned x = 0x811c9dc5u;
        for (size_t i = 0; p && i < (size_t)w * h * 4; i++) x = (x ^ p[i]) * 0x01000193u;
        printf("%08x\\n", x);
    }
}
static void tap(int32_t id, uint32_t at) {
    const int32_t *b = hmi_bh_bounds();
    for (int i = 0; i < hmi_bh_bounds_count(); i++, b += 5) {
        if (b[0] != id) continue;
        const int32_t x = b[1] + b[3] / 2, y = b[2] + b[4] / 2;
        hmi_bh_pointer(0, x, y);
        hmi_bh_frame(at);
        hmi_bh_pointer(2, x, y);
        return;
    }
    printf("element %d not drawn\\n", (int)id);
}
int main() {
    if (hmi_bh_init(480, 320, ${OPERATOR}) != 0) return 2;
    hmi_bh_frame(0);
    ${steps}
    return 0;
}
`
}

interface Bh {
  memory: WebAssembly.Memory
  fn: (name: string) => (...args: number[]) => number
}

async function instantiate(wasm: Uint8Array, role: number): Promise<Bh> {
  const module = await WebAssembly.compile(wasm)
  const wasi: Record<string, () => number> = {}
  for (const i of WebAssembly.Module.imports(module)) wasi[i.name] = () => 52
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi })
  const exports = instance.exports
  const memory = exports.memory
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('no memory export')
  const fn = (name: string) => {
    const value = exports[name]
    if (typeof value !== 'function') throw new Error(`no export ${name}`)
    return (...args: number[]) => Number(Reflect.apply(value, undefined, args))
  }
  if (typeof exports._initialize === 'function') fn('_initialize')()
  if (fn('hmi_bh_init')(480, 320, role) !== 0) throw new Error('hmi_bh_init failed')
  fn('hmi_bh_frame')(0)
  return { memory, fn }
}

function send(bh: Bh, payload: Uint8Array): number {
  const at = bh.fn('hmi_bh_in')(payload.length)
  new Uint8Array(bh.memory.buffer, at, payload.length).set(payload)
  return bh.fn('hmi_bh_values')(payload.length)
}

function tap(bh: Bh, id: number, at: number): boolean {
  const count = bh.fn('hmi_bh_bounds_count')()
  const b = new Int32Array(bh.memory.buffer, bh.fn('hmi_bh_bounds')(), count * 5)
  for (let i = 0; i < count; i++) {
    if (b[i * 5] !== id) continue
    const x = b[i * 5 + 1] + Math.trunc(b[i * 5 + 3] / 2)
    const y = b[i * 5 + 2] + Math.trunc(b[i * 5 + 4] / 2)
    bh.fn('hmi_bh_pointer')(0, x, y)
    bh.fn('hmi_bh_frame')(at)
    bh.fn('hmi_bh_pointer')(2, x, y)
    return true
  }
  return false
}

interface WriteRecord {
  page: number
  tag: number
  kind: number
  bit: number
  value: number[]
}

/** The write records queued since the last clear. */
function records(bh: Bh): WriteRecord[] {
  const len = bh.fn('hmi_bh_out_len')()
  const bytes = new Uint8Array(bh.memory.buffer, bh.fn('hmi_bh_out')(), len)
  const out: WriteRecord[] = []
  for (let off = 0; off < len; ) {
    const n = bytes[off + 6] | (bytes[off + 7] << 8)
    out.push({
      page: bytes[off] | (bytes[off + 1] << 8),
      tag: bytes[off + 2] | (bytes[off + 3] << 8),
      kind: bytes[off + 4],
      bit: bytes[off + 5],
      value: [...bytes.slice(off + 8, off + 8 + n)],
    })
    off += 8 + n
  }
  bh.fn('hmi_bh_out_clear')()
  return out
}

/** The whole-value writes queued since the last clear, as [tag, bytes]. */
function writes(bh: Bh): Array<[number, number[]]> {
  return records(bh).map((r) => [r.tag, r.value])
}

function renderHashes(bh: Bh): string[] {
  const out: string[] = []
  for (const scale of [1, 2]) {
    const w = 480 * scale
    const h = 320 * scale
    const p = bh.fn('hmi_bh_render')(w, h, 256 * scale)
    out.push(p === 0 ? 'none' : fnv(new Uint8Array(bh.memory.buffer, p, w * h * 4)))
  }
  return out
}

async function main(): Promise<void> {
  const clang = await runner()
  const cache = new Map<string, CachedWasmObject>()
  const compile = (request: WasmCompileRequest) => compileToWasm(request, { runner: clang, cache })
  const project = sampleProject()
  project.screens = project.screens.map((screen) =>
    screen.name === 'Details'
      ? {
          ...screen,
          source: screen.source.replace(
            '  END_VAR\n',
            '  END_VAR\n  METHOD PROTECTED OVERRIDE OnShow : BOOL\n    instance0.Main.Speed := 7;\n    instance0.Main.Unused.3 := TRUE;\n    OnShow := TRUE;\n  END_METHOD\n',
          ),
        }
      : screen,
  )
  const PIN = '97531864'
  project.settings = { ...project.settings, pin: { enabled: true, value: PIN }, relock: { mode: 'idle', minutes: 47 } }
  const leaves = [
    ['INSTANCE0.LEVEL', 0, 3],
    ['INSTANCE0.RUNNING', 0, 4],
    ['INSTANCE0.SPEED', 0, 5],
    ['INSTANCE0.TAG', 1, 0],
    ['ALARMON', 2, 0],
    ['INSTANCE0.UNUSED', 0, 6],
  ].map(([path, arrayIdx, elemIdx]) => ({ path, arrayIdx, elemIdx, type: 'BOOL', size: 1 }))
  const headers = runtimeHeaders()
  let request: WasmCompileRequest | null = null

  const start = performance.now()
  const artefact = await composeHmiArtefact({
    sources: project,
    plcArchives: [],
    debugMapJson: JSON.stringify({ version: 2, md5: 'x', leaves }),
    md5: MD5,
    instances: [{ name: 'instance0', program: 'Main' }],
    hmiSources: readAll(HMI),
    runtimeHeaders: headers,
    compile: (r) => {
      request = r
      return compile(r)
    },
  })
  if (!artefact.ok) throw new Error(artefact.errors.map((e) => `${e.file}: ${e.message}`).join('\n'))
  console.log(`artefact composed in ${Math.round(performance.now() - start)} ms`)
  const files = artefact.files
  check(files['hmi/manifest.json'] === HMI_INSTALL_MANIFEST, 'the manifest installs a format 2 HMI')
  const names = Object.keys(files).sort()
  check(
    JSON.stringify(names.filter((n) => n.startsWith('hmi/src/'))) ===
      JSON.stringify(['hmi/src/hmi_access.c', 'hmi/src/hmi_access.h']),
    'the device gets only the host-side manifest, no screen code',
  )
  for (const name of [
    'index.html',
    'hmi-client.js',
    'hmi.css',
    'socket.io.min.js',
    'socket.io-LICENSE.txt',
    'fonts-LICENSE.txt',
    HMI_CLIENT_MODULE,
  ])
    check(files[`hmi/client/${name}`] !== undefined, `the artefact has client/${name}`)
  check(
    names.every((n) => /^hmi\/(manifest\.json|src\/[A-Za-z0-9._-]+\.[ch]|client\/[A-Za-z0-9._-]{1,64})$/.test(n)),
    'every path passes the runtime upload rules',
  )
  check(
    names.filter((n) => n.startsWith('hmi/client/')).every((n) => /\.(html|js|css|wasm|txt|ttf)$/.test(n)),
    'client files have only the extensions the runtime serves',
  )
  const access = String(files['hmi/src/hmi_access.c'])
  check(access.includes(`const char hmi_access_plc_md5[] = "${MD5}";`), 'the manifest carries the program MD5')
  check(
    access.includes('static const uint16_t reads_0[5] = {0, 1, 2, 3, 4};') &&
      access.includes(
        'static const hmi_access_write_t writes_0[3] = {{1, 1, 0x0ULL, 0, 0.0, 0.0}, {2, 1, 0x0ULL, 0, 0.0, 0.0}, {3, 1, 0x0ULL, 1, 0.0, 12.0}};',
      ) &&
      access.includes('static const uint16_t reads_1[2] = {3, 5};') &&
      access.includes(
        'static const hmi_access_write_t writes_1[2] = {{2, 1, 0x0ULL, 1, 7.0, 7.0}, {5, 0, 0x8ULL, 0, 0.0, 0.0}};',
      ) &&
      access.includes('{reads_1, 2, writes_1, 2, 3}, /* Details */'),
    'each screen lists the tags it reads and writes, and the roles that may open it',
  )

  /* The manifest compiles as C on its own, as the runtime builds it. */
  const work = mkdtempSync(join(tmpdir(), 'hmi-client-'))
  try {
    writeFileSync(join(work, 'hmi_access.c'), access)
    writeFileSync(join(work, 'hmi_access.h'), String(files['hmi/src/hmi_access.h']))
    execFileSync(CC, [
      '-std=c11',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-c',
      join(work, 'hmi_access.c'),
      '-o',
      join(work, 'a.o'),
    ])
    check(true, 'hmi_access.c compiles as C11 with -Wall -Wextra -Werror')

    const wasm = files[`hmi/client/${HMI_CLIENT_MODULE}`]
    if (!(wasm instanceof Uint8Array)) throw new Error('hmi.wasm is not bytes')
    const ascii = Buffer.from(wasm).toString('latin1')
    check(
      !ascii.includes(PIN) &&
        Object.values(files).every(
          (f) => !(typeof f === 'string' ? f : Buffer.from(f).toString('latin1')).includes(PIN),
        ),
      'the panel PIN is in no file of the artefact, hmi.wasm included',
    )
    check(
      !ascii.includes('Enter PIN') && !ascii.includes('Wrong PIN'),
      "the panel's PIN entry is not linked into hmi.wasm (the browser host never calls it)",
    )
    const compiledRequest: WasmCompileRequest | null = request
    check(
      compiledRequest !== null &&
        Object.entries(compiledRequest.files).every(
          ([path, f]) =>
            path.endsWith('hmi_fonts.c') || !/97531864|hmi_panel_pin\s*\[\]\s*=|hmi_relock_minutes\s*=/.test(f),
        ),
      'the browser module is compiled without the PIN or the relock time',
    )
    const module = await WebAssembly.compile(wasm)
    check(
      WebAssembly.Module.imports(module).every((i) => i.module === 'wasi_snapshot_preview1' && i.kind === 'function'),
      'the module imports only WASI functions',
    )
    const unit = generateHmiUnit({ ...project, plcMd5: MD5 })
    const ids = Object.fromEntries(
      unit.elementIds.filter((e) => e.screen === 'Overview').map((e) => [e.element.toUpperCase(), e.id]),
    )

    const bh = await instantiate(wasm, OPERATOR)
    check(bh.fn('hmi_bh_frame_ms')() === 50, 'the module reports the frame period')
    check(bh.fn('hmi_bh_page')() === 0, 'the start screen shows')
    check(send(bh, values(0, 0, [[1, [1]]])) === 0, 'VALUES are applied and name their page')
    bh.fn('hmi_bh_frame')(100)
    check(tap(bh, ids.RUN, 150), 'the switch is drawn')
    bh.fn('hmi_bh_frame')(200)
    check(
      JSON.stringify(writes(bh)) === JSON.stringify([[1, [0]]]),
      'a tap on a switch that is on queues Running := FALSE',
    )
    bh.fn('hmi_bh_frame')(250)
    check(writes(bh).length === 0, 'the written value is kept until the device answers')
    send(bh, values(0, 0, [[1, [1]]]))
    bh.fn('hmi_bh_frame')(300)
    tap(bh, ids.RUN, 350)
    bh.fn('hmi_bh_frame')(400)
    check(
      JSON.stringify(writes(bh)) === JSON.stringify([[1, [1]]]),
      'a value sent before the device processed the write is skipped (the switch toggles from its own write)',
    )
    send(bh, values(0, 2, [[1, [0]]]))
    bh.fn('hmi_bh_frame')(450)
    tap(bh, ids.RUN, 500)
    bh.fn('hmi_bh_frame')(550)
    check(JSON.stringify(writes(bh)) === JSON.stringify([[1, [1]]]), 'a value sent after it is applied')
    check(send(bh, values(0, 0, [[1, [1, 2]]])) === 0, 'a value of the wrong width is skipped')
    check(send(bh, values(0, 0, [[99, [1]]])) === -1, 'an unknown tag is refused whole')
    check(
      send(bh, values(0, 0, [[3, text('much too long for STRING(12)')]])) === 0,
      'a STRING past its length is skipped',
    )
    const cut = values(0, 0, [[1, [1]]])
    check(send(bh, cut.slice(0, cut.length - 1)) === -1, 'a cut message is refused')
    tap(bh, ids.NEXT, 600)
    bh.fn('hmi_bh_frame')(650)
    check(bh.fn('hmi_bh_page')() === 0, 'an operator may not open Details: the unit keeps its role grid')
    const admin = await instantiate(wasm, 0)
    records(admin)
    tap(admin, ids.NEXT, 50)
    admin.fn('hmi_bh_frame')(100)
    admin.fn('hmi_bh_frame')(150)
    check(admin.fn('hmi_bh_page')() === 1, 'an admin opens Details with the same tap')
    const entry = records(admin)
    check(
      JSON.stringify(entry) ===
        JSON.stringify([
          { page: 1, tag: 2, kind: 0, bit: 0, value: [7, 0] },
          { page: 1, tag: 5, kind: 1, bit: 3, value: [1] },
        ]),
      `the writes Details makes on entry (OnShow) are tagged with Details, the bit assignment as a bit write (${JSON.stringify(entry)})`,
    )

    const viewer = await instantiate(wasm, VIEWER)
    check(viewer.fn('hmi_bh_page')() === 0, 'a viewer starts on Overview, which its role is granted')

    /* Same pixels as the same sources built natively. */
    const wasmHashes: string[] = []
    const replay = await instantiate(wasm, OPERATOR)
    SCRIPT.forEach((step, i) => {
      if (step.values) send(replay, step.values)
      if (step.tap) tap(replay, ids[step.tap], i * 100 + 50)
      replay.fn('hmi_bh_frame')((i + 1) * 100)
      wasmHashes.push(...renderHashes(replay))
    })
    const compiled: WasmCompileRequest | null = request
    if (!compiled) throw new Error('no compile request')
    const src = join(work, 'src')
    for (const [path, content] of Object.entries(compiled.files)) {
      mkdirSync(join(src, path, '..'), { recursive: true })
      writeFileSync(join(src, path), content)
    }
    writeFileSync(join(src, 'driver.cpp'), nativeDriver(SCRIPT, ids))
    const objects: string[] = []
    for (const unitFile of compiled.units) {
      const object = join(work, `${objects.length}.o`)
      const c = unitFile.language === 'c'
      execFileSync(c ? CC : CXX, [
        ...(c ? (compiled.cFlags ?? []) : (compiled.cxxFlags ?? [])).filter((f) => !f.startsWith('-I')),
        ...(c ? (compiled.cFlags ?? []) : (compiled.cxxFlags ?? []))
          .filter((f) => f.startsWith('-I'))
          .map((f) => `-I${join(src, f.slice(2))}`),
        '-w',
        '-c',
        join(src, unitFile.source),
        '-o',
        object,
      ])
      objects.push(object)
    }
    const exe = join(work, 'driver')
    execFileSync(CXX, ['-std=gnu++17', '-O2', join(src, 'driver.cpp'), ...objects, '-lm', '-o', exe])
    const nativeHashes = execFileSync(exe).toString().trim().split('\n')
    check(
      JSON.stringify(nativeHashes) === JSON.stringify(wasmHashes),
      `the browser draws the same pixels as the native build, 1x and 2x, through values, a tap and a write (${wasmHashes.length} frames)`,
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    console.log(`\n${failures.length} check(s) failed`)
    process.exit(1)
  }
  console.log('\nhmi client: all checks passed')
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error)
  process.exit(1)
})
