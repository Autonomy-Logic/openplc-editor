/**
 * @file run.mjs
 * Tests of the HMI C core: golden scenes, unit tests and fuzzing, on native compilers and on WebAssembly.
 *
 *   node tests/hmi-core/run.mjs [--cc "gcc clang"] [--no-wasm] [--sanitize] [--fuzz N] [--update] [--png DIR]
 *
 * Every native compiler builds with -Wall -Wextra -Werror. Scenes are rendered with both font variants and must print
 * the lines in golden.txt on every target (pixel identity); a scene whose text stays within ASCII and Latin-1 must
 * render the same with both variants. --update rewrites golden.txt from the first target. --sanitize also builds the unit
 * tests and the fuzzer with AddressSanitizer and UndefinedBehaviorSanitizer (first compiler) and runs N fuzz inputs.
 * --png writes the scenes as PNG files for review.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32, deflateSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CORE = join(ROOT, 'resources', 'sources', 'hmi', 'core')
const CORE_SOURCES = ['hmi_core.c', 'hmi_theme.c', 'hmi_math.c', 'hmi_raster.c', 'hmi_text.c']
const CFLAGS = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-ffp-contract=off']
const SANITIZE = [
  '-O1',
  '-g',
  '-fsanitize=address,undefined,float-cast-overflow',
  '-fno-sanitize-recover=all',
  '-fno-omit-frame-pointer',
]
/* Unit builds may force stb_truetype allocations to fail. */
const UNIT_DEFINES = ['-DHMI_TEST_ALLOC_FAIL']
/* Font tables: [variant, faces]. Unit tests run with each; scenes with the two complete ones. */
const TABLES = [
  ['full', 'all'],
  ['full', 'regular'],
  ['full', 'none'],
  ['compact', 'all'],
]
const VARIANTS = ['full', 'compact']
/* Scenes drawing characters outside ASCII and Latin-1, which the compact variant does not have. */
const OUTSIDE_COMPACT = new Set(['text', 'text_2x', 'text_1_25x'])
const key = (variant, faces) => `${variant}_${faces}`
const GOLDEN = join(HERE, 'golden.txt')

function parseArgs(argv) {
  const opts = { cc: ['cc'], wasm: true, sanitize: false, fuzz: 0, update: false, png: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--cc') opts.cc = argv[++i].split(/\s+/).filter(Boolean)
    else if (a === '--no-wasm') opts.wasm = false
    else if (a === '--sanitize') opts.sanitize = true
    else if (a === '--fuzz') opts.fuzz = Number(argv[++i])
    else if (a === '--update') opts.update = true
    else if (a === '--png') opts.png = argv[++i]
    else throw new Error(`unknown argument ${a}`)
  }
  if (opts.sanitize && !opts.fuzz) opts.fuzz = 20000
  return opts
}

function run(cmd, args, options = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...options })
  if (r.error) throw r.error
  return r
}

function must(r, what) {
  if (r.status !== 0) {
    process.stderr.write(r.stdout ?? '')
    process.stderr.write(r.stderr ?? '')
    throw new Error(`${what} failed (exit ${r.status})`)
  }
  return r.stdout
}

/* Font tables through the real font build step. */
function fontTables(dir) {
  const tables = {}
  for (const [variant, faces] of TABLES) {
    const out = join(dir, `fonts_${key(variant, faces)}.c`)
    must(
      run('npx', ['ts-node', '-T', join(HERE, 'font-table.ts'), out, faces, variant], { cwd: ROOT }),
      `font table ${variant} ${faces}`,
    )
    tables[key(variant, faces)] = out
  }
  return tables
}

function nativeBuild(cc, flags, sources, out, extra = []) {
  must(
    run(cc, [...flags, `-I${CORE}`, ...CORE_SOURCES.map((s) => join(CORE, s)), ...sources, ...extra, '-lm', '-o', out]),
    `${cc} ${basename(out)}`,
  )
  return out
}

/* Virtual file tree for the WebAssembly clang. */
function wasmTree(tables) {
  const core = {}
  for (const f of readdirSync(CORE)) if (/\.(c|h)$/.test(f)) core[f] = readFileSync(join(CORE, f), 'utf8')
  core.third_party = { 'stb_truetype.h': readFileSync(join(CORE, 'third_party', 'stb_truetype.h'), 'utf8') }
  const tests = {}
  for (const f of ['scenes.c', 'unit.c']) tests[f] = readFileSync(join(HERE, f), 'utf8')
  for (const [variant, faces] of TABLES)
    tests[`fonts_${key(variant, faces)}.c`] = readFileSync(tables[key(variant, faces)], 'utf8')
  return { core, tests }
}

async function wasmBuild(tree, sources, out, flags = []) {
  const { runClang } = await import('@yowasp/clang')
  const args = [
    'clang',
    '--target=wasm32-wasip1',
    ...CFLAGS,
    ...flags,
    '-Icore',
    ...CORE_SOURCES.map((s) => `core/${s}`),
    ...sources,
    '-lm',
    '-o',
    'out.wasm',
  ]
  const result = await runClang(args, tree)
  writeFileSync(out, result['out.wasm'])
  return out
}

function runTarget(target, args = []) {
  if (target.endsWith('.wasm'))
    return run(process.execPath, ['--no-warnings', join(HERE, 'wasi-run.mjs'), target, ...args])
  return run(target, args)
}

function writePngs(dumpDir, pngDir) {
  mkdirSync(pngDir, { recursive: true })
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
    const crc = Buffer.alloc(4)
    crc.writeUInt32BE(crc32(body) >>> 0)
    return Buffer.concat([len, body, crc])
  }
  for (const f of readdirSync(dumpDir).filter((n) => n.endsWith('.rgba'))) {
    const raw = readFileSync(join(dumpDir, f))
    const w = raw.readInt32LE(0),
      h = raw.readInt32LE(4)
    const rows = []
    for (let y = 0; y < h; y++) rows.push(Buffer.from([0]), raw.subarray(8 + y * w * 4, 8 + (y + 1) * w * 4))
    const ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(w, 0)
    ihdr.writeUInt32BE(h, 4)
    ihdr.set([8, 6, 0, 0, 0], 8)
    const png = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ])
    writeFileSync(join(pngDir, f.replace(/\.rgba$/, '.png')), png)
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const work = mkdtempSync(join(tmpdir(), 'hmi-core-'))
  let failed = false
  const fail = (msg) => {
    console.error(`FAIL ${msg}`)
    failed = true
  }
  try {
    const tables = fontTables(work)
    const targets = [] // { name, scenes: { variant: path }, units: { table key: path } }
    for (const cc of opts.cc) {
      const name = basename(cc)
      const scenes = {}
      for (const variant of VARIANTS)
        scenes[variant] = nativeBuild(
          cc,
          CFLAGS,
          [join(HERE, 'scenes.c'), tables[key(variant, 'all')]],
          join(work, `scenes_${name}_${variant}`),
        )
      const units = {}
      for (const [variant, faces] of TABLES)
        units[key(variant, faces)] = nativeBuild(
          cc,
          [...CFLAGS, ...UNIT_DEFINES],
          [join(HERE, 'unit.c'), tables[key(variant, faces)]],
          join(work, `unit_${name}_${key(variant, faces)}`),
        )
      targets.push({ name, scenes, units })
    }
    if (opts.wasm) {
      const tree = wasmTree(tables)
      const scenes = {}
      for (const variant of VARIANTS)
        scenes[variant] = await wasmBuild(
          tree,
          ['tests/scenes.c', `tests/fonts_${key(variant, 'all')}.c`],
          join(work, `scenes_${variant}.wasm`),
        )
      const units = {}
      for (const [variant, faces] of TABLES)
        units[key(variant, faces)] = await wasmBuild(
          tree,
          ['tests/unit.c', `tests/fonts_${key(variant, faces)}.c`],
          join(work, `unit_${key(variant, faces)}.wasm`),
          UNIT_DEFINES,
        )
      targets.push({ name: 'wasm32', scenes, units })
    }
    if (targets.length === 0) throw new Error('no target to test')

    let reference = null
    for (const t of targets) {
      for (const [variant, faces] of TABLES) {
        const r = runTarget(t.units[key(variant, faces)])
        const label = `${t.name} unit (${variant} fonts, ${faces})`
        if (r.status !== 0) fail(`${label}:\n${r.stderr}${r.stdout}`)
        else console.log(`${label}: ${r.stdout.trim()}`)
      }
      let lines = ''
      for (const variant of VARIANTS) {
        const dump = opts.png && t === targets[0] ? join(work, 'dump', variant) : null
        if (dump) mkdirSync(dump, { recursive: true })
        const r = runTarget(t.scenes[variant], dump ? [dump] : [])
        if (r.status !== 0) {
          fail(`${t.name} scenes (${variant} fonts):\n${r.stderr}${r.stdout}`)
          continue
        }
        if (dump) writePngs(dump, join(opts.png, variant))
        lines += r.stdout
          .trim()
          .split('\n')
          .map((line) => `${variant} ${line}\n`)
          .join('')
      }
      reference ??= lines
      if (lines !== reference) fail(`${t.name} scenes differ from ${targets[0].name}:\n${lines}`)
      else console.log(`${t.name} scenes: ${lines.trim().split('\n').length} renders`)
    }
    if (reference !== null) {
      /* The compact variant has the same outlines, advances and kerning, so it must draw the same pixels. */
      const byScene = new Map()
      for (const line of reference.trim().split('\n')) {
        const [variant, scene, , hash] = line.split(' ')
        byScene.set(scene, { ...byScene.get(scene), [variant]: hash })
      }
      for (const [scene, hashes] of byScene) {
        const same = hashes.full === hashes.compact
        if (OUTSIDE_COMPACT.has(scene) === same)
          fail(`${scene}: full and compact fonts ${same ? 'agree but should not' : 'differ'}`)
      }
      if (opts.update) {
        writeFileSync(GOLDEN, reference)
        console.log(`golden.txt updated from ${targets[0].name}`)
      } else if (reference !== readFileSync(GOLDEN, 'utf8')) {
        fail(`scenes differ from golden.txt:\n${reference}`)
      } else {
        console.log('scenes match golden.txt; compact and full fonts draw the same pixels for ASCII and Latin-1')
      }
    }

    /* FMA guard: where a compiler can fuse the text code, a -ffp-contract=fast build must fail the golden check. */
    if (reference !== null) {
      const expected = reference
        .split('\n')
        .filter((l) => l.startsWith('full '))
        .map((l) => l.slice(5))
        .join('\n')
      for (const cc of opts.cc) {
        const asm = run(cc, [
          '-std=c11',
          '-O2',
          '-ffp-contract=fast',
          `-I${CORE}`,
          '-S',
          '-o',
          '-',
          join(CORE, 'hmi_text.c'),
        ])
        const fused = (must(asm, `${cc} -S hmi_text.c`).match(/\b(v?f(n?)m(add|sub)|fmla|fmls)\w*/g) ?? []).length
        if (fused === 0) {
          console.log(`${basename(cc)} FMA guard: no fused operations on this target or compiler`)
          continue
        }
        const fast = nativeBuild(
          cc,
          ['-std=c11', '-O2', '-ffp-contract=fast'],
          [join(HERE, 'scenes.c'), tables[key('full', 'all')]],
          join(work, `scenes_fast_${basename(cc)}`),
        )
        const r = runTarget(fast)
        if (r.status === 0 && r.stdout.trim() === expected.trim())
          fail(
            `${basename(cc)}: a build with ${fused} fused operations matches golden.txt; the scenes cannot detect FMA`,
          )
        else
          console.log(
            `${basename(cc)} FMA guard: a -ffp-contract=fast build (${fused} fused operations) fails the golden check`,
          )
      }
    }

    if (opts.sanitize) {
      const cc = opts.cc[0]
      const unit = nativeBuild(
        cc,
        ['-std=c11', ...SANITIZE, ...UNIT_DEFINES, '-Wall', '-Wextra', '-Werror'],
        [join(HERE, 'unit.c'), tables[key('full', 'all')]],
        join(work, 'unit_san'),
      )
      const r = runTarget(unit)
      if (r.status !== 0) fail(`sanitized unit:\n${r.stderr}${r.stdout}`)
      else console.log(`sanitized unit: ${r.stdout.trim()}`)
      const fuzz = nativeBuild(
        cc,
        ['-std=c11', ...SANITIZE, '-Wall', '-Wextra', '-Werror'],
        [join(HERE, 'fuzz.c'), tables[key('compact', 'all')]],
        join(work, 'fuzz_san'),
      )
      const f = runTarget(fuzz, [String(opts.fuzz)])
      if (f.status !== 0) fail(`fuzz:\n${f.stderr}${f.stdout}`)
      else console.log(`sanitized ${f.stdout.trim()}`)
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  if (failed) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
