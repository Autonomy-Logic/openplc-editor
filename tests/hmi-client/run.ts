/**
 * The HMI artefact of a Runtime v4 upload, outside the app: composes the sample project's `hmi/` folder with the real
 * WebAssembly clang, loads the browser client's module and checks that it draws a display list to the same pixels as
 * the core built natively, as the runtime builds it.
 *
 *   npx ts-node -T -r tsconfig-paths/register tests/hmi-client/run.ts
 *
 * HMI_CLIENT_CC names the native C compiler (default cc).
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'

import { composeHmiArtefact } from '../../src/backend/shared/hmi/artefact/compose-hmi-artefact'
import { sampleProject } from '../../src/backend/shared/hmi/unit/__tests__/fixtures/sample-project'
import { isYowaspClang, runClangJob } from '../../src/backend/shared/wasm-toolchain/clang-worker-host'
import { type CachedWasmObject, compileToWasm } from '../../src/backend/shared/wasm-toolchain/compile-to-wasm'
import type { WasmClangRunner } from '../../src/middleware/shared/ports/wasm-toolchain-mechanisms'
import type { WasmCompileRequest } from '../../src/middleware/shared/ports/wasm-toolchain-types'

const ROOT = join(__dirname, '..', '..')
const HMI = join(ROOT, 'resources', 'sources', 'hmi')
const CC = process.env.HMI_CLIENT_CC ?? 'cc'

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

async function runner(): Promise<WasmClangRunner> {
  const clang: unknown = await import('@yowasp/clang')
  if (!isYowaspClang(clang)) throw new Error('@yowasp/clang is not the expected module')
  return {
    concurrency: Math.max(1, Math.min(4, cpus().length - 1)),
    prepare: () => Promise.resolve(),
    run: (job) => runClangJob(clang, job.argv, job.tree),
  }
}

/** A display list with every kind of shape and both faces, `width` x `height` logical units. */
function displayList(width: number, height: number): Uint8Array {
  const out: number[] = []
  const u8 = (v: number) => out.push(v & 0xff)
  const u16 = (v: number) => {
    u8(v)
    u8(v >> 8)
  }
  const u32 = (v: number) => {
    u16(v & 0xffff)
    u16(v >>> 16)
  }
  const q4 = (v: number) => u32(Math.round(v * 16) | 0)
  const commands: Array<() => void> = [
    () => (u8(1), u32(0xfff7f8fa)),
    () => (u8(2), q4(20), q4(20), q4(200), q4(60), q4(8), u32(0xff0464fb)),
    () => (u8(3), q4(20), q4(100), q4(200), q4(60), q4(12), q4(2), u32(0xff111827)),
    () => (u8(4), q4(240), q4(20), q4(300), q4(160), q4(3), u32(0xffdc2626)),
    () => (u8(5), q4(380), q4(80), q4(40), u32(0x8016a34a)),
    () => (u8(6), q4(380), q4(200), q4(40), q4(6), u32(0 * 64), u32(270 * 64), u32(0xfff59e0b)),
    ...[0, 1].map((font) => () => {
      const text = new TextEncoder().encode(font === 0 ? 'Level 42.5 %' : 'Pump ÄÖÜ')
      u8(7), q4(30), q4(190 + font * 30), q4(18), u8(font), u8(0), u32(0xff1f2937), u16(text.length)
      text.forEach(u8)
    }),
  ]
  u32(0x4c444d48), u16(1), u16(0), u32(width), u32(height), u32(commands.length)
  commands.forEach((c) => c())
  return new Uint8Array(out)
}

/** FNV-1a over the bytes, as the native driver prints it. */
function fnv(bytes: Uint8Array): string {
  let h = 0x811c9dc5
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0
  return h.toString(16).padStart(8, '0')
}

const NATIVE_DRIVER = `#include <stdio.h>
#include <stdlib.h>
#include "hmi_core.h"
int main(int argc, char **argv) {
    FILE *f = fopen(argv[1], "rb"); static unsigned char dl[1 << 16]; size_t n = fread(dl, 1, sizeof dl, f); fclose(f);
    int w = atoi(argv[2]), h = atoi(argv[3]), q8 = atoi(argv[4]);
    unsigned char *rgba = calloc((size_t)w * h, 4);
    if (hmi_raster_render(dl, n, rgba, w, h, w, 0, h, q8, 0, 0) != HMI_RASTER_OK) return 2;
    unsigned h32 = 0x811c9dc5u; for (size_t i = 0; i < (size_t)w * h * 4; i++) h32 = (h32 ^ rgba[i]) * 0x01000193u;
    printf("%08x\\n", h32); return 0;
}
`

async function main(): Promise<void> {
  const clang = await runner()
  const cache = new Map<string, CachedWasmObject>()
  const compile = (request: WasmCompileRequest) => compileToWasm(request, { runner: clang, cache })
  const project = sampleProject()
  const leaves = [
    ['INSTANCE0.LEVEL', 0, 3],
    ['INSTANCE0.RUNNING', 0, 4],
    ['INSTANCE0.SPEED', 0, 5],
    ['INSTANCE0.TAG', 1, 0],
    ['ALARMON', 2, 0],
  ].map(([path, arrayIdx, elemIdx]) => ({ path, arrayIdx, elemIdx, type: 'BOOL', size: 1 }))

  const start = performance.now()
  const artefact = await composeHmiArtefact({
    sources: project,
    plcArchives: [],
    debugMapJson: JSON.stringify({ version: 2, md5: 'x', leaves }),
    md5: '0123456789abcdef0123456789abcdef',
    instances: [{ name: 'instance0', program: 'Main' }],
    hmiSources: readAll(HMI),
    compile,
  })
  if (!artefact.ok) throw new Error(artefact.errors.map((e) => `${e.file}: ${e.message}`).join('\n'))
  console.log(`artefact composed in ${Math.round(performance.now() - start)} ms`)
  const files = artefact.files
  check(files['hmi/manifest.json'] === '{"format": 1}\n', 'the manifest installs the HMI')
  check(
    artefact.tags.every((t) => t.address !== null),
    'every tag has a debug address',
  )
  for (const name of [
    'hmi/src/hmi_unit_glue.cpp',
    'hmi/src/hmi_unit.h',
    'hmi/src/hmi_fonts.c',
    'hmi/src/core/hmi_core.c',
    'hmi/src/core/third_party/stb_truetype.h',
    'hmi/client/index.html',
    'hmi/client/hmi-client.js',
    'hmi/client/hmi.css',
    'hmi/client/socket.io.min.js',
    'hmi/client/socket.io-LICENSE.txt',
    'hmi/client/fonts-LICENSE.txt',
    'hmi/client/hmi_client.wasm',
  ])
    check(files[name] !== undefined, `the artefact has ${name}`)
  const names = Object.keys(files)
  check(
    names.every((n) =>
      /^hmi\/(manifest\.json|src\/[A-Za-z0-9._\/-]+\.(c|h|cpp|hpp)|client\/[A-Za-z0-9._-]{1,64})$/.test(n),
    ),
    'every path passes the runtime upload rules',
  )
  check(
    names.filter((n) => n.startsWith('hmi/client/')).every((n) => /\.(html|js|css|wasm|txt|ttf)$/.test(n)),
    'client files have only the extensions the runtime serves',
  )
  const html = String(files['hmi/client/index.html'])
  check(!/<script>|<style|\sstyle=|\son[a-z]+=/i.test(html), 'index.html has no inline script or style (CSP)')

  const wasm = files['hmi/client/hmi_client.wasm']
  if (!(wasm instanceof Uint8Array)) throw new Error('hmi_client.wasm is not bytes')
  const module = await WebAssembly.compile(wasm)
  const imports = WebAssembly.Module.imports(module)
  check(
    imports.every((i) => i.module === 'wasi_snapshot_preview1' && i.kind === 'function'),
    'the client module imports only WASI functions',
  )
  const wasi: Record<string, () => number> = {}
  for (const i of imports) wasi[i.name] = () => 52
  const instance = await WebAssembly.instantiate(module, { wasi_snapshot_preview1: wasi })
  const exports = instance.exports
  const memory = exports.memory
  const fn = (name: string): ((...args: number[]) => number) => {
    const value = exports[name]
    if (typeof value !== 'function') throw new Error(`no export ${name}`)
    return (...args: number[]) => Number(Reflect.apply(value, undefined, args))
  }
  if (!(memory instanceof WebAssembly.Memory)) throw new Error('no memory export')
  if (typeof exports._initialize === 'function') fn('_initialize')()
  const dl = displayList(480, 320)
  const target = fn('hmi_client_dl')(dl.length)
  new Uint8Array(memory.buffer, target, dl.length).set(dl)
  const size = fn('hmi_client_dl_size')(dl.length)
  check((size & 0xffff) === 480 && size >>> 16 === 320, 'hmi_client_dl_size reads the logical size')
  check(fn('hmi_client_dl')(0) === 0 && fn('hmi_client_dl')(5 * 1024 * 1024) === 0, 'refuses empty and oversized lists')

  const work = mkdtempSync(join(tmpdir(), 'hmi-client-'))
  try {
    const coreDir = join(HMI, 'core')
    writeFileSync(join(work, 'fonts.c'), String(files['hmi/src/hmi_fonts.c']))
    writeFileSync(join(work, 'driver.c'), NATIVE_DRIVER)
    writeFileSync(join(work, 'dl.bin'), dl)
    const exe = join(work, 'driver')
    execFileSync(CC, [
      '-std=c11',
      '-O2',
      '-ffp-contract=off',
      `-I${coreDir}`,
      ...['hmi_raster.c', 'hmi_text.c', 'hmi_math.c'].map((f) => join(coreDir, f)),
      join(work, 'fonts.c'),
      join(work, 'driver.c'),
      '-lm',
      '-o',
      exe,
    ])
    for (const [ratio, label] of [
      [1, '1x'],
      [2, '2x'],
      [1.5, '1.5x'],
    ] as const) {
      const pw = Math.round(480 * ratio)
      const ph = Math.round(320 * ratio)
      const q8 = Math.round(ratio * 256)
      const pixels = fn('hmi_client_render')(dl.length, pw, ph, q8)
      const browser = pixels === 0 ? 'none' : fnv(new Uint8Array(memory.buffer, pixels, pw * ph * 4))
      const native = execFileSync(exe, [join(work, 'dl.bin'), String(pw), String(ph), String(q8)])
        .toString()
        .trim()
      check(browser === native, `the client draws the same pixels as the native core at ${label} (${browser})`)
    }
    check(fn('hmi_client_render')(dl.length, 0, 10, 256) === 0, 'refuses an empty surface')
    const bad = fn('hmi_client_dl')(dl.length)
    new Uint8Array(memory.buffer, bad, 4).set([0, 0, 0, 0])
    check(fn('hmi_client_render')(dl.length, 10, 10, 256) === 0, 'refuses a list without the magic')
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
