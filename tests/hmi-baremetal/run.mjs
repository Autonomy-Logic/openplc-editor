/**
 * @file run.mjs
 * The baremetal HMI host end to end on native compilers: generates the sample project's unit, font table and
 * hmi_config.h with the real build steps (generate.ts), builds the core, the unit and the host with HMI_STATIC_MEMORY,
 * and checks that
 *   - the host and core objects of a product build reference no heap function and carry no test readout;
 *   - firmware without a panel driver links against the weak defaults and leaves the HMI off (no_panel.c);
 *   - the host draws what the core renders, skips unchanged bands, takes touch, PIN and relock right and never runs
 *     past the slack it is given, in simulated time (host_test.c);
 *   - the firmware's Modbus PDU layer frames, routes and answers the test-only readout codes 0x4E and 0x4F
 *     (pdu_test.cpp, built against the simulator's Arduino stub);
 *   - a panel whose touch needs calibrating calibrates at startup, keeps its calibration in the store across restarts
 *     as each calibration mode says, starts over after a missed target, shows the startup screen first and opens the
 *     calibration on a press held there, which never reaches the screens (host_cal_test.c, one binary per mode).
 * --sanitize builds the test programs with AddressSanitizer and UndefinedBehaviorSanitizer.
 * Needs STruC++ installed (`npm run setup:strucpp`).
 *
 *   node tests/hmi-baremetal/run.mjs [--cc "gcc clang"] [--sanitize]
 */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const HMI = join(ROOT, 'resources', 'sources', 'hmi')
const CORE = join(HMI, 'core')
const HOST = join(HMI, 'baremetal')
const UNIT_API = join(HMI, 'unit')
const GLUE = join(ROOT, 'resources', 'sources', 'arduino')
const BAREMETAL = join(ROOT, 'resources', 'sources', 'Baremetal')
const SIM = join(ROOT, 'resources', 'sources', 'wasm-sim')
const PDU_SOURCES = ['modbus_pdu.cpp', 'modbus_debug.cpp', 'modbus_frame.cpp'].map((f) => join(BAREMETAL, f))
const RUNTIME_INCLUDE = join(ROOT, 'node_modules', 'strucpp', 'src', 'runtime', 'include')
const CORE_SOURCES = ['hmi_core.c', 'hmi_theme.c', 'hmi_math.c', 'hmi_raster.c', 'hmi_text.c']
const CFLAGS = ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', '-ffp-contract=off']
const CXXFLAGS = ['-std=gnu++17', '-O2', '-ffp-contract=off']
const CXX = { gcc: 'g++', clang: 'clang++', cc: 'c++' }
/** Heap entry points, C and C++ (operator new and new[] for 32- and 64-bit size_t). */
const HEAP_SYMBOL = /^_?(malloc|calloc|realloc|free|aligned_alloc|posix_memalign|_Znwm|_Znam|_Znwj|_Znaj)$/
const READOUT_SYMBOL = /^_?hmi_bm_(dl_hold|dl_read|stats)$/
const SANITIZE = ['-O1', '-g', '-fsanitize=address,undefined', '-fno-sanitize-recover=all', '-fno-omit-frame-pointer']

function parseArgs(argv) {
  const opts = { cc: ['cc'], sanitize: false }
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cc') opts.cc = argv[++i].split(/\s+/).filter(Boolean)
    else if (argv[i] === '--sanitize') opts.sanitize = true
    else throw new Error(`unknown argument ${argv[i]}`)
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

/** Symbols of an object file: `undefined` or `defined` ones, names only. */
function symbols(obj, which) {
  const out = must(run('nm', which === 'undefined' ? ['-u', obj] : ['-g', '--defined-only', obj]), `nm ${obj}`)
  return out
    .split('\n')
    .map((line) => line.trim().split(/\s+/).pop())
    .filter(Boolean)
}

/** Compiles the core, the font table and the host against the hmi_config.h of variant, with extra flags. */
function buildC(cc, work, gen, variant, extra = []) {
  const includes = [`-I${join(gen, variant)}`, `-I${CORE}`, `-I${HOST}`, `-I${UNIT_API}`, `-I${GLUE}`]
  const objects = { core: [], host: null, fonts: null }
  const compile = (src, flags, tag) => {
    const obj = join(work, `${basename(cc)}_${variant}_${tag}.o`)
    must(run(cc, [...flags, ...extra, ...includes, '-c', src, '-o', obj]), `${cc} ${basename(src)} (${variant})`)
    return obj
  }
  for (const s of CORE_SOURCES) objects.core.push(compile(join(CORE, s), CFLAGS, basename(s, '.c')))
  objects.fonts = compile(join(gen, 'fonts.c'), ['-std=c11', '-O2', '-ffp-contract=off'], 'fonts')
  objects.host = compile(join(HOST, 'hmi_baremetal.c'), CFLAGS, 'host')
  return { objects, includes }
}

/** Compiles the unit's C++ against the hmi_config.h of variant, with extra flags; skip names files left out. */
function buildUnit(cc, work, gen, variant, includes, extra = [], skip = []) {
  const cxx = CXX[basename(cc)] ?? cc
  const unitDir = join(gen, 'unit')
  return readdirSync(unitDir)
    .filter((f) => f.endsWith('.cpp') && !skip.includes(f))
    .map((f) => {
      const obj = join(work, `${basename(cc)}_${variant}_unit_${basename(f, '.cpp')}.o`)
      must(
        run(cxx, [
          ...CXXFLAGS,
          ...extra,
          `-I${RUNTIME_INCLUDE}`,
          `-I${unitDir}`,
          ...includes,
          '-c',
          join(unitDir, f),
          '-o',
          obj,
        ]),
        `${cxx} ${f} (${variant})`,
      )
      return obj
    })
}

function link(cc, out, objects, extra = []) {
  const cxx = CXX[basename(cc)] ?? cc
  must(run(cxx, [...extra, ...objects, '-lm', '-o', out]), `link ${basename(out)}`)
  return out
}

const UNIT_GLUE = 'hmi_unit_glue.cpp'
const CAL_MODES = ['once', 'upload', 'upload-next', 'boot', 'nopin']

/** Builds host_cal_test once per calibration mode (the unit glue differs), against the calibrating panel's config. */
function buildCalTests(cc, work, gen, extra) {
  const name = basename(cc)
  const cxx = CXX[name] ?? cc
  const c = buildC(cc, work, gen, 'readout-cal', extra)
  const unit = buildUnit(cc, work, gen, 'readout-cal', c.includes, extra, [UNIT_GLUE])
  const driver = join(work, `${name}_host_cal_test.o`)
  must(
    run(cc, [...CFLAGS, ...extra, `-I${join(gen, 'unit')}`, ...c.includes, '-c', join(HERE, 'host_cal_test.c'), '-o', driver]),
    'host_cal_test.c',
  )
  const exes = {}
  for (const mode of CAL_MODES) {
    const glue = join(work, `${name}_glue_${mode}.o`)
    must(
      run(cxx, [
        ...CXXFLAGS,
        ...extra,
        `-I${RUNTIME_INCLUDE}`,
        `-I${join(gen, 'unit')}`,
        ...c.includes,
        '-c',
        join(gen, 'glue', mode, UNIT_GLUE),
        '-o',
        glue,
      ]),
      `${cxx} ${UNIT_GLUE} (${mode})`,
    )
    exes[mode] = link(
      cc,
      join(work, `${name}_host_cal_test_${mode}`),
      [driver, ...c.objects.core, c.objects.host, c.objects.fonts, ...unit, glue],
      extra,
    )
  }
  return exes
}

/** Runs the calibration scenarios across restarts that share one store file per mode; returns the failures. */
function runCalTests(exes, work, name) {
  const failures = []
  const store = join(work, `${name}_panel_store.bin`)
  const step = (mode, scenario) => {
    const r = run(exes[mode], [store, scenario])
    process.stdout.write(`${name}: cal ${mode}: ${r.stdout}`)
    if (r.status !== 0) failures.push(`${name} calibration ${mode} ${scenario} (exit ${r.status})\n${r.stderr}`)
  }
  const fresh = () => rmSync(store, { force: true })
  fresh()
  step('once', 'calibrate')
  step('once', 'stored')
  const bytes = readFileSync(store)
  bytes[30] ^= 0xff
  writeFileSync(store, bytes)
  step('once', 'calibrate')
  step('once', 'hold')
  fresh()
  step('once', 'miss')
  fresh()
  step('upload', 'calibrate')
  step('upload', 'stored')
  step('upload-next', 'calibrate')
  step('upload-next', 'stored')
  step('boot', 'calibrate')
  step('boot', 'calibrate')
  fresh()
  step('nopin', 'calibrate')
  step('nopin', 'splash')
  step('nopin', 'short')
  step('nopin', 'hold')
  return failures
}

/** Builds and runs the Modbus PDU test of the readout codes; returns its result. */
function runPduTest(cc, work, extra) {
  const cxx = CXX[basename(cc)] ?? cc
  const includes = [
    `-I${join(HERE, 'pdu')}`,
    `-I${join(SIM, 'stub')}`,
    `-I${join(SIM, 'core')}`,
    `-I${BAREMETAL}`,
    `-I${GLUE}`,
    `-I${HOST}`,
  ]
  const flags = ['-std=gnu++17', '-O2', '-DHMI_TEST_READOUT', '-w', ...extra, ...includes]
  const objects = [...PDU_SOURCES, join(HERE, 'pdu_test.cpp')].map((src) => {
    const obj = join(work, `${basename(cc)}_pdu_${basename(src, '.cpp')}.o`)
    must(run(cxx, [...flags, '-c', src, '-o', obj]), `${cxx} ${basename(src)} (pdu)`)
    return obj
  })
  return run(link(cc, join(work, `${basename(cc)}_pdu_test`), objects, extra), [])
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const work = mkdtempSync(join(tmpdir(), 'hmi-baremetal-'))
  const gen = join(work, 'gen')
  let failed = false
  const fail = (msg) => {
    console.error(`FAIL ${msg}`)
    failed = true
  }
  try {
    must(
      run('npx', ['ts-node', '-T', '-r', 'tsconfig-paths/register', join(HERE, 'generate.ts'), gen], { cwd: ROOT }),
      'generation',
    )
    for (const cc of opts.cc) {
      const name = basename(cc)
      const product = buildC(cc, work, gen, 'product')
      const productObjects = [...product.objects.core, product.objects.host]
      for (const obj of productObjects) {
        const heap = symbols(obj, 'undefined').filter((s) => HEAP_SYMBOL.test(s))
        if (heap.length > 0) fail(`${name}: ${basename(obj)} references the heap: ${heap.join(', ')}`)
      }
      const readout = symbols(product.objects.host, 'defined').filter((s) => READOUT_SYMBOL.test(s))
      if (readout.length > 0) fail(`${name}: the product host defines the test readout: ${readout.join(', ')}`)
      else console.log(`${name}: product host and core reference no heap and carry no test readout`)

      const productUnit = buildUnit(cc, work, gen, 'product', product.includes)
      const unitHeap = productUnit.flatMap((obj) => symbols(obj, 'undefined').filter((s) => HEAP_SYMBOL.test(s)))
      console.log(`${name}: unit heap references: ${unitHeap.length > 0 ? [...new Set(unitHeap)].join(', ') : 'none'}`)
      const noPanelObj = join(work, `${name}_no_panel.o`)
      must(run(cc, [...CFLAGS, ...product.includes, '-c', join(HERE, 'no_panel.c'), '-o', noPanelObj]), 'no_panel.c')
      const noPanel = link(cc, join(work, `${name}_no_panel`), [
        noPanelObj,
        ...productObjects,
        product.objects.fonts,
        ...productUnit,
      ])
      const np = run(noPanel, [])
      if (np.status !== 0) fail(`${name} no panel:\n${np.stdout}${np.stderr}`)
      else console.log(`${name}: no panel driver: links, HMI stays off`)

      const san = opts.sanitize ? SANITIZE : []
      const test = buildC(cc, work, gen, 'readout', san)
      const testUnit = buildUnit(cc, work, gen, 'readout', test.includes, san)
      const driverObj = join(work, `${name}_host_test.o`)
      must(
        run(cc, [
          ...CFLAGS,
          ...san,
          `-I${join(gen, 'unit')}`,
          ...test.includes,
          '-c',
          join(HERE, 'host_test.c'),
          '-o',
          driverObj,
        ]),
        'host_test.c',
      )
      const exe = link(
        cc,
        join(work, `${name}_host_test`),
        [driverObj, ...test.objects.core, test.objects.host, test.objects.fonts, ...testUnit],
        san,
      )
      const r = run(exe, [])
      process.stdout.write(r.stdout.split('\n').map((l) => (l ? `${name}: ${l}` : l)).join('\n'))
      if (r.status !== 0) fail(`${name} host test (exit ${r.status})\n${r.stderr}`)
      const pdu = runPduTest(cc, work, san)
      process.stdout.write(pdu.stdout.split('\n').map((l) => (l ? `${name}: ${l}` : l)).join('\n'))
      if (pdu.status !== 0) fail(`${name} PDU test (exit ${pdu.status})\n${pdu.stderr}`)
      for (const f of runCalTests(buildCalTests(cc, work, gen, san), work, name)) fail(f)
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
