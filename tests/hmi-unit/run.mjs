/**
 * @file run.mjs
 * The HMI unit generator end to end: generates the sample project's unit (the shared Jest fixture) with the real generator,
 * builds it with the C core and driver.c (a C host using only hmi_unit.h) on each native compiler, runs the scripted
 * viewers and checks the output against golden.txt. Needs STruC++ installed (`npm run setup:strucpp`).
 *
 *   node tests/hmi-unit/run.mjs [--cc "gcc clang"] [--sanitize] [--update] [--png DIR]
 *
 * --sanitize adds a build of the first compiler with AddressSanitizer and UndefinedBehaviorSanitizer, whose output
 * must match too.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { writePngs } from '../hmi-core/png.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const CORE = join(ROOT, 'resources', 'sources', 'hmi', 'core')
const UNIT_API = join(ROOT, 'resources', 'sources', 'hmi', 'unit')
const CORE_SOURCES = ['hmi_core.c', 'hmi_theme.c', 'hmi_math.c', 'hmi_raster.c', 'hmi_text.c']
const RUNTIME_INCLUDE = join(ROOT, 'node_modules', 'strucpp', 'src', 'runtime', 'include')
const CFLAGS = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-ffp-contract=off']
/* STruC++ output and the generated glue build with the flags product builds use. */
const CXXFLAGS = ['-std=gnu++17', '-O2', '-ffp-contract=off']
const SANITIZE = ['-O1', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-fno-omit-frame-pointer']
const GOLDEN = join(HERE, 'golden.txt')

/* Flags of a target: the sanitized one trades -O2 for AddressSanitizer and UndefinedBehaviorSanitizer. */
const withSanitizer = (flags, sanitize) => (sanitize ? [...flags.filter((f) => f !== '-O2'), ...SANITIZE] : flags)
const CXX = { gcc: 'g++', clang: 'clang++', cc: 'c++' }

function parseArgs(argv) {
  const opts = { cc: ['cc'], update: false, png: null, sanitize: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--cc') opts.cc = argv[++i].split(/\s+/).filter(Boolean)
    else if (a === '--update') opts.update = true
    else if (a === '--sanitize') opts.sanitize = true
    else if (a === '--png') opts.png = argv[++i]
    else throw new Error(`unknown argument ${a}`)
  }
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

function generate(work) {
  const unit = join(work, 'unit')
  must(
    run('npx', ['ts-node', '-T', '-r', 'tsconfig-paths/register', join(HERE, 'generate.ts'), unit], { cwd: ROOT }),
    'unit generation',
  )
  const fonts = join(work, 'fonts.c')
  must(
    run('npx', ['ts-node', '-T', join(ROOT, 'tests', 'hmi-core', 'font-table.ts'), fonts, 'all', 'compact'], {
      cwd: ROOT,
    }),
    'font table',
  )
  return { unit, fonts }
}

function build(cc, work, { unit, fonts }, sanitize = false) {
  const name = `${basename(cc)}${sanitize ? '-sanitized' : ''}`
  const objects = []
  const compileC = (src, flags) => {
    const obj = join(work, `${name}_${basename(src, '.c')}.o`)
    must(
      run(cc, [...withSanitizer(flags, sanitize), `-I${CORE}`, `-I${UNIT_API}`, `-I${unit}`, '-c', src, '-o', obj]),
      `${cc} ${basename(src)}`,
    )
    objects.push(obj)
  }
  for (const s of CORE_SOURCES) compileC(join(CORE, s), CFLAGS)
  compileC(fonts, ['-std=c11', '-O2', '-ffp-contract=off'])
  compileC(join(HERE, 'driver.c'), CFLAGS)
  const cxx = CXX[basename(cc)] ?? cc
  const out = join(work, `driver_${name}`)
  const cpp = readdirSync(unit)
    .filter((f) => f.endsWith('.cpp'))
    .map((f) => join(unit, f))
  must(
    run(cxx, [
      ...withSanitizer(CXXFLAGS, sanitize),
      `-I${RUNTIME_INCLUDE}`,
      `-I${CORE}`,
      `-I${UNIT_API}`,
      `-I${unit}`,
      ...cpp,
      ...objects,
      '-lm',
      '-o',
      out,
    ]),
    `${cxx} unit`,
  )
  return { name, out }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const work = mkdtempSync(join(tmpdir(), 'hmi-unit-'))
  let failed = false
  const fail = (msg) => {
    console.error(`FAIL ${msg}`)
    failed = true
  }
  try {
    const generated = generate(work)
    const summary = JSON.parse(readFileSync(join(generated.unit, 'result.json'), 'utf8'))
    let reference = [
      `warnings ${JSON.stringify(summary.warnings)}`,
      `fonts ${JSON.stringify(summary.fonts)}`,
      `units ${JSON.stringify(summary.units)}`,
      '',
    ].join('\n')
    let first = null
    const targets = [
      ...opts.cc.map((cc) => ({ cc, sanitize: false })),
      ...(opts.sanitize ? [{ cc: opts.cc[0], sanitize: true }] : []),
    ]
    for (const { cc, sanitize } of targets) {
      const target = build(cc, work, generated, sanitize)
      const dump = opts.png && first === null ? join(work, 'dump') : null
      if (dump) mkdirSync(dump, { recursive: true })
      const r = run(target.out, dump ? [dump] : [])
      if (r.status !== 0) {
        fail(`${target.name} driver:\n${r.stderr}${r.stdout}`)
        continue
      }
      if (dump) writePngs(dump, opts.png)
      first ??= r.stdout
      if (r.stdout !== first) fail(`${target.name} output differs from ${opts.cc[0]}`)
      else console.log(`${target.name}: ${r.stdout.trim().split('\n').length} lines`)
    }
    if (first !== null) {
      reference += first
      if (opts.update) {
        writeFileSync(GOLDEN, reference)
        console.log('golden.txt updated')
      } else if (reference !== readFileSync(GOLDEN, 'utf8')) {
        fail(`output differs from golden.txt:\n${reference}`)
      } else {
        console.log('output matches golden.txt')
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  if (failed) process.exit(1)
}

try {
  main()
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}
