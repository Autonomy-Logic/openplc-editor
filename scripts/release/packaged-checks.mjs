#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs'
import { connect, createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

import {
  archiveFiles,
  extractAsar,
  listFiles,
  locateFile,
  readArchiveFile,
  readAsarHeader,
  runAsarCli,
} from './lib/asar.mjs'
import { CheckFailure, parseCli } from './lib/cli.mjs'
import { VERSION } from './lib/release-assets.mjs'
import { parseTrustedKeys, scanPaths, trustNeedles } from './lib/trust-literals.mjs'
import { EQSP32_PACKAGE_ID, placePackageByHand, writeEqsp32Vpp } from './lib/vpp-fixture.mjs'

/** The packaged checks, in the order they run and are reported. */
export const CHECK_IDS = Object.freeze([
  'start',
  'ABUSE-01',
  'ABUSE-02',
  'ABUSE-06 row 1',
  'ABUSE-06 row 2',
  'ABUSE-07 ELECTRON_RUN_AS_NODE',
  'ABUSE-07 NODE_OPTIONS',
  'ABUSE-07 --inspect',
  'ABUSE-07 --inspect-brk',
  'ABUSE-07 SIGUSR1',
  'ABUSE-13 (a)',
  'ABUSE-13 (b)',
  'ABUSE-03 (b)',
  'ABUSE-03 (e)',
  'AC5 compile',
  'AC5 packages install',
])

/** The sha256 of the Autonomy-signed fx3u package the positive controls install. */
export const FX3U_SHA256 = '8a949877a1ee0e48cfc3fc9f6efff2e106b0aecd3b1fec9050de858c679e3fa6'

/** The package id and one board of the fx3u package. */
const FX3U_PACKAGE_ID = 'com.openplc.fx3u-compatible'
const FX3U_BOARD = 'FX3U-14M / LE3U-14M'

/** The `--platform` values. */
const PLATFORMS = ['mac', 'win', 'linux']

/** How long an editor must stay alive to count as started, and the default window of `observeStart`. */
const START_WINDOW_MS = 30_000

/** How much stderr `observeStart` keeps, and how much of it a report keeps per check. */
const STDERR_KEPT = 64 * 1024
const EVIDENCE_STDERR = 4 * 1024

/** How much output an editor command line run keeps per stream. */
const CLI_OUTPUT_KEPT = 8 * 1024 * 1024

/** Bounds of the editor command line runs, in milliseconds. */
const CLI_SHORT_MS = 5 * 60_000
const CLI_COMPILE_MS = 10 * 60_000
const CLI_INSTALL_MS = 30 * 60_000

/** Bounds of the SIGUSR1 check: time before the signal is sent and time watched after it. */
const SIGUSR1_SETTLE_MS = 15_000
const SIGUSR1_WATCH_MS = 10_000

/** Node's inspector banner. */
const INSPECTOR_BANNER = 'Debugger listening on ws://'

/** What the reproducer prints when the trusted-keys object is not found. */
const REPRODUCER_NOT_FOUND = 'Could not locate the trusted-keys object in dist/main'

/** The refusal texts of the editor: on import, and on use of an installed package. */
const IMPORT_REFUSAL = 'Package signature verification failed'
const INTEGRITY_REFUSAL = 'no longer matches its signature'

/** The source that marks the chunk holding the trust module in a hardened build's source maps. */
const TRUST_SOURCE_SUFFIX = 'package-trust/package-trust-anchor.ts'

/** The key id an original installer's trusted-keys object holds. */
const TRUSTED_KEY_LITERAL = '"openplc-2026"'

/** The reproducer of the published trust patch. */
const REPRODUCER = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'patch-trust-reproducer.mjs')

/** Where ABUSE-13 (b) moves `app.asar` while the editor starts. */
const MOVED_ARCHIVE_SUFFIX = '.moved-by-packaged-checks'

/** The project the command line checks create. */
const PROJECT_NAME = 'packaged-checks'

/** Skip reasons, by platform, version and run. */
const SKIP = Object.freeze({
  asarIntegrity: 'ABUSE-06 needs ASAR integrity: macOS and Windows only',
  sigusr1: 'no SIGUSR1 on Windows',
  arduinoCore: 'the arduino core download runs on Linux x64 only',
  packagesCli: 'openplc-cli packages exists from 4.3.2',
  abuse03Negative:
    "an unpatched original refuses another key's package too; the CRA gives ABUSE-03 no negative control",
  positiveOnly: 'positive controls run on the hardened installer',
  appFolderNegative:
    'an unpatched original loads app.asar before an app folder too, so the inverted check would be blind',
})

/** The checks a negative-control run keeps in normal mode. */
const NEGATIVE_NORMAL = new Set(['start', 'ABUSE-07 NODE_OPTIONS'])

/** The checks a negative-control run skips, with the reason. */
const NEGATIVE_SKIPS = Object.freeze({
  'ABUSE-13 (a)': SKIP.appFolderNegative,
  'ABUSE-03 (b)': SKIP.abuse03Negative,
  'ABUSE-03 (e)': SKIP.abuse03Negative,
  'AC5 compile': SKIP.positiveOnly,
  'AC5 packages install': SKIP.positiveOnly,
})

/** Every process an editor run started and has not yet reaped. */
const running = new Set()

/**
 * The numeric parts of a `<major>.<minor>.<patch>` version.
 * @param {string} version
 * @returns {number[]}
 */
function versionParts(version) {
  if (!VERSION.test(String(version)))
    throw new Error(`version ${JSON.stringify(version)} is not <major>.<minor>.<patch>`)
  return version.split('.').map(Number)
}

/**
 * True when `version` is `floor` or later, compared part by part as numbers.
 * @param {string} version
 * @param {string} floor
 */
function isAtLeast(version, floor) {
  const a = versionParts(version)
  const b = versionParts(floor)
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] > b[index]
  return true
}

/**
 * Why a check does not run on this platform or version, in both runs; undefined when it runs.
 * @param {string} id
 * @param {string} platform
 * @param {string} version
 * @returns {string | undefined}
 */
function platformSkip(id, platform, version) {
  if ((id === 'ABUSE-06 row 1' || id === 'ABUSE-06 row 2') && platform === 'linux') return SKIP.asarIntegrity
  if (id === 'ABUSE-07 SIGUSR1' && platform === 'win') return SKIP.sigusr1
  if (id === 'AC5 packages install' && platform !== 'linux') return SKIP.arduinoCore
  if ((id === 'ABUSE-03 (b)' || id === 'AC5 packages install') && !isAtLeast(version, '4.3.2')) return SKIP.packagesCli
  return undefined
}

/**
 * The mode of every check for one run, in `CHECK_IDS` order; `reason` is present exactly on skipped checks.
 * @param {{ platform: string, version: string, negativeControl: boolean }} run
 * @returns {{ id: string, mode: 'normal' | 'inverted' | 'skipped', reason?: string }[]}
 */
export function planChecks({ platform, version, negativeControl }) {
  if (!PLATFORMS.includes(platform)) {
    throw new Error(`unknown platform ${JSON.stringify(platform)}: expected ${PLATFORMS.join(', ')}`)
  }
  versionParts(version)
  return CHECK_IDS.map((id) => {
    const reason = platformSkip(id, platform, version) ?? (negativeControl ? NEGATIVE_SKIPS[id] : undefined)
    if (reason !== undefined) return { id, mode: 'skipped', reason }
    return { id, mode: negativeControl && !NEGATIVE_NORMAL.has(id) ? 'inverted' : 'normal' }
  })
}

/**
 * The verdict of an abuse check: a normal check passes when the attack did not succeed, an inverted one when it did.
 * @param {{ mode: 'normal' | 'inverted', attackSucceeded: boolean }} observation
 * @returns {'pass' | 'fail'}
 */
export function judge({ mode, attackSucceeded }) {
  if (mode === 'normal') return attackSucceeded ? 'fail' : 'pass'
  if (mode === 'inverted') return attackSucceeded ? 'pass' : 'fail'
  throw new Error(`only a normal or inverted check is judged, not ${JSON.stringify(mode)}`)
}

/**
 * The `dist/main` file the in-place edit of ABUSE-06 row 2 targets: the `.js` whose source map lists the trust module,
 * otherwise the `.js` holding the original trusted key id.
 * @param {string} archivePath
 * @returns {{ path: string, reason: string }}
 * @throws {Error} naming `dist/main` when no file matches either rule.
 */
export function findTrustChunk(archivePath) {
  const files = listFiles(archivePath, 'dist/main')
  const scripts = files.filter((file) => file.endsWith('.js'))
  for (const script of scripts) {
    if (!files.includes(`${script}.map`)) continue
    let sources
    try {
      sources = JSON.parse(readArchiveFile(archivePath, `${script}.map`).toString('utf8')).sources
    } catch {
      continue
    }
    if (
      Array.isArray(sources) &&
      sources.some((source) => String(source).replaceAll('\\', '/').endsWith(TRUST_SOURCE_SUFFIX))
    ) {
      return { path: script, reason: `source map lists ${TRUST_SOURCE_SUFFIX}` }
    }
  }
  for (const script of scripts) {
    if (readArchiveFile(archivePath, script).includes(TRUSTED_KEY_LITERAL)) {
      return { path: script, reason: `holds the key id ${TRUSTED_KEY_LITERAL}` }
    }
  }
  throw new Error(
    `no file of dist/main in ${archivePath} matches: no source map lists ${TRUST_SOURCE_SUFFIX} and no .js holds ${TRUSTED_KEY_LITERAL}`,
  )
}

/**
 * Starts a process with piped output and records it until it is reaped. The handle's `drained` waits at most 2 s for
 * both output streams to close; `stop` kills the process tree and waits for the process to end.
 * @param {{ command: string, args?: string[], env?: NodeJS.ProcessEnv, cwd?: string, outputKept?: number }} options
 */
function launch({ command, args = [], env, cwd, outputKept = STDERR_KEPT }) {
  const startedAt = Date.now()
  const child = spawn(command, args, {
    cwd,
    env: env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
    windowsHide: true,
  })
  running.add(child)
  const stdout = keptStream(child.stdout, outputKept)
  const stderr = keptStream(child.stderr, outputKept)
  const ended = new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ exitCode: code, signal, ms: Date.now() - startedAt }))
  })
  ended.then(
    () => running.delete(child),
    () => running.delete(child),
  )
  return {
    child,
    startedAt,
    ended,
    stdout: () => stdout.text(),
    stderr: () => stderr.text(),
    drained: () => raceTimeout(Promise.all([stdout.closed, stderr.closed]), 2_000),
    stop: async () => {
      killTree(child)
      await ended.catch(() => undefined)
    },
  }
}

/**
 * Collects the first `limit` bytes of a stream and drains the rest.
 * @param {import('node:stream').Readable} stream
 * @param {number} limit
 */
function keptStream(stream, limit) {
  const chunks = []
  let kept = 0
  stream.on('data', (chunk) => {
    if (kept >= limit) return
    const part = chunk.subarray(0, limit - kept)
    chunks.push(part)
    kept += part.length
  })
  const closed = new Promise((resolve) => stream.once('close', resolve))
  return { closed, text: () => Buffer.concat(chunks).toString('utf8') }
}

/** Kills a process and every process of its group or tree. */
function killTree(child) {
  if (child.pid === undefined) return
  if (process.platform === 'win32') {
    if (child.exitCode === null && child.signalCode === null) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore', windowsHide: true })
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      return
    }
  }
}

/**
 * Resolves to the promise's value, or to `undefined` when `ms` pass first.
 * @template T
 * @param {Promise<T>} promise
 * @param {number} ms
 * @returns {Promise<T | undefined>}
 */
async function raceTimeout(promise, ms) {
  const controller = new AbortController()
  try {
    return await Promise.race([promise, sleep(ms, undefined, { signal: controller.signal }).then(() => undefined)])
  } finally {
    controller.abort()
  }
}

/**
 * Starts a command and watches it for a window: `starts` when it is still alive at the end (it is then killed),
 * `does-not-start` when it ended within the window with a non-zero exit code or by a signal, `exited-zero` when it
 * exited 0 within the window.
 * @param {{ command: string, args?: string[], env?: NodeJS.ProcessEnv, cwd?: string, windowMs?: number }} options
 *   `env` is the whole environment of the process, `process.env` when omitted.
 * @returns {Promise<{ verdict: 'starts' | 'does-not-start' | 'exited-zero', exitCode: number | null,
 *   signal: string | null, ms: number, stderr: string }>} `stderr` holds its first 64 KiB.
 * @throws {Error} when the command cannot be started at all.
 */
export async function observeStart({ command, args = [], env, cwd, windowMs = START_WINDOW_MS }) {
  const run = launch({ command, args, env, cwd })
  try {
    const ended = await raceTimeout(run.ended, windowMs)
    if (ended === undefined) {
      const ms = Date.now() - run.startedAt
      await run.stop()
      await run.drained()
      return { verdict: 'starts', exitCode: null, signal: null, ms, stderr: run.stderr() }
    }
    await run.drained()
    return {
      verdict: ended.exitCode === 0 ? 'exited-zero' : 'does-not-start',
      exitCode: ended.exitCode,
      signal: ended.signal,
      ms: ended.ms,
      stderr: run.stderr(),
    }
  } finally {
    await run.stop()
  }
}

/**
 * Runs a command to its end, killed after `timeoutMs`.
 * @param {{ command: string, args: string[], env?: NodeJS.ProcessEnv, cwd?: string, timeoutMs: number }} options
 * @returns {Promise<{ exitCode: number | null, signal: string | null, ms: number, stdout: string, stderr: string,
 *   timedOut: boolean }>}
 */
async function runCommand({ command, args, env, cwd, timeoutMs }) {
  const run = launch({ command, args, env, cwd, outputKept: CLI_OUTPUT_KEPT })
  try {
    const ended = await raceTimeout(run.ended, timeoutMs)
    if (ended === undefined) {
      const ms = Date.now() - run.startedAt
      await run.stop()
      await run.drained()
      return { exitCode: null, signal: null, ms, stdout: run.stdout(), stderr: run.stderr(), timedOut: true }
    }
    await run.drained()
    return { ...ended, stdout: run.stdout(), stderr: run.stderr(), timedOut: false }
  } finally {
    await run.stop()
  }
}

/**
 * Runs a command synchronously and throws with its output when it does not exit 0.
 * @param {string} command
 * @param {string[]} args
 * @param {import('node:child_process').SpawnSyncOptions} [options]
 * @returns {string} its stdout.
 */
function mustRun(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: CLI_SHORT_MS, windowsHide: true, ...options })
  if (result.error) throw new Error(`${command} ${args.join(' ')}: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? result.signal}: ${result.stderr ?? ''}`)
  }
  return String(result.stdout ?? '')
}

/** The sha256 hex digest of a file. */
function sha256File(path) {
  const hash = createHash('sha256')
  const fd = openSync(path, 'r')
  try {
    const buffer = Buffer.alloc(1024 * 1024)
    for (let read = readSync(fd, buffer); read > 0; read = readSync(fd, buffer)) hash.update(buffer.subarray(0, read))
  } finally {
    closeSync(fd)
  }
  return hash.digest('hex')
}

/** True when the path names a regular file. */
function isFile(path) {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** True when the directory exists and holds at least one regular file at any depth. */
function holdsFiles(dir) {
  if (!existsSync(dir)) return false
  return readdirSync(dir, { withFileTypes: true }).some(
    (entry) => entry.isFile() || (entry.isDirectory() && holdsFiles(join(dir, entry.name))),
  )
}

/** True when the file starts with the ELF magic number. */
function isElf(path) {
  const fd = openSync(path, 'r')
  try {
    const magic = Buffer.alloc(4)
    return readSync(fd, magic, 0, 4, 0) === 4 && magic.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
  } finally {
    closeSync(fd)
  }
}

/** A port on 127.0.0.1 nothing listens on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => resolve(typeof address === 'object' && address !== null ? address.port : 0))
    })
  })
}

/** True when a TCP connection to 127.0.0.1:`port` opens within `ms`. */
function accepts(port, ms) {
  return new Promise((resolve) => {
    const socket = connect({ host: '127.0.0.1', port })
    const done = (open) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(ms, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/** Probes a port until it accepts a connection or `until` settles; true when it accepted one. */
async function watchPort(port, until) {
  let settled = false
  until.then(
    () => (settled = true),
    () => (settled = true),
  )
  while (!settled) {
    if (await accepts(port, 500)) return true
    await raceTimeout(until, 500)
  }
  return accepts(port, 500)
}

/** The environment of an editor start: this process's, without the two variables the injection checks set. */
function editorEnv(extra = {}) {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  return { ...env, ...extra }
}

/** A script that writes `marker` when Node runs it; `then` is appended after the write. */
function markerScript(marker, then = '') {
  return `require('fs').writeFileSync(${JSON.stringify(marker)}, 'attacker code ran\\n')\n${then}`
}

/** Quotes a path for `NODE_OPTIONS` only when it needs it. */
function nodeOptionPath(path) {
  return /[\s"]/.test(path) ? `"${path.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"` : path
}

/**
 * Index and new value of a same-length edit that keeps a script parseable: the first space becomes a tab, or else the
 * first tab becomes a space.
 * @param {Buffer} bytes
 * @returns {{ index: number, from: number, to: number }}
 */
function whitespaceEdit(bytes) {
  const space = bytes.indexOf(0x20)
  if (space !== -1) return { index: space, from: 0x20, to: 0x09 }
  const tab = bytes.indexOf(0x09)
  if (tab !== -1) return { index: tab, from: 0x09, to: 0x20 }
  throw new Error('the file holds no space or tab to change')
}

/** The `--unpack` arguments that keep the archive's unpacked entries unpacked on a repack. */
function unpackArgs(header) {
  const patterns = [
    ...new Set(
      archiveFiles(header)
        .filter((file) => file.unpacked)
        .map((file) => {
          const name = file.path.split('/').pop() ?? file.path
          const dot = name.lastIndexOf('.')
          return dot > 0 ? `*${name.slice(dot)}` : name
        }),
    ),
  ].sort()
  if (patterns.length === 0) return []
  return ['--unpack', patterns.length === 1 ? patterns[0] : `{${patterns.join(',')}}`]
}

/**
 * Installs one platform's installer under `work`.
 * @param {string} platform
 * @param {string} installer
 * @param {string} work
 * @returns {{ executable: string, resourcesDir: string, archive: string, root: string, baseArgs: string[],
 *   detail: string, uninstall: () => void }}
 */
function installEditor(platform, installer, work) {
  if (platform === 'mac') return installMac(installer, work)
  if (platform === 'win') return installWindows(installer, work)
  return installLinux(installer, work)
}

/** Mounts the DMG, copies its contents and detaches it. */
function installMac(installer, work) {
  const mount = join(work, 'dmg')
  const root = join(work, 'installed')
  mkdirSync(mount)
  mustRun('hdiutil', ['attach', '-nobrowse', '-noautoopen', '-readonly', '-mountpoint', mount, installer])
  try {
    mustRun('ditto', [mount, root])
  } finally {
    spawnSync('hdiutil', ['detach', mount, '-force'], { stdio: 'ignore', timeout: CLI_SHORT_MS })
  }
  const apps = readdirSync(root).filter((name) => name.endsWith('.app'))
  if (apps.length !== 1) throw new Error(`the DMG holds ${apps.length} .app bundles: ${apps.join(', ')}`)
  const app = join(root, apps[0])
  const name = mustRun('plutil', [
    '-extract',
    'CFBundleExecutable',
    'raw',
    '-o',
    '-',
    join(app, 'Contents', 'Info.plist'),
  ])
  const resourcesDir = join(app, 'Contents', 'Resources')
  return {
    executable: join(app, 'Contents', 'MacOS', name.trim()),
    resourcesDir,
    archive: join(resourcesDir, 'app.asar'),
    root,
    baseArgs: [],
    detail: `copied ${apps[0]} from the DMG`,
    uninstall: () => undefined,
  }
}

/** Runs the NSIS installer silently for the current user; the uninstaller is run by `uninstall`. */
function installWindows(installer, work) {
  const copy = join(work, 'installer.exe')
  const target = join(work, 'installed')
  copyFileSync(installer, copy)
  mustRun(copy, ['/S', '/currentuser', `/D=${target}`], {
    windowsVerbatimArguments: true,
    argv0: `"${copy}"`,
    timeout: CLI_INSTALL_MS,
  })
  const candidates = [target, join(process.env.LOCALAPPDATA ?? '', 'Programs', 'OpenPLC Editor')]
  const root = candidates.find((dir) => windowsExecutables(dir).length === 1)
  if (root === undefined) throw new Error(`no installed editor found in ${candidates.join(' or ')}`)
  const resourcesDir = join(root, 'resources')
  return {
    executable: join(root, windowsExecutables(root)[0]),
    resourcesDir,
    archive: join(resourcesDir, 'app.asar'),
    root,
    baseArgs: [],
    detail: `installed into ${root}`,
    uninstall: () => {
      const uninstaller = readdirSync(root).find((name) => /^Uninstall .*\.exe$/i.test(name))
      if (uninstaller === undefined) return
      spawnSync(join(root, uninstaller), ['/S', '/currentuser', `_?=${root}`], {
        windowsVerbatimArguments: true,
        argv0: `"${join(root, uninstaller)}"`,
        stdio: 'ignore',
        timeout: CLI_SHORT_MS,
        windowsHide: true,
      })
    },
  }
}

/** The editor executables directly in a Windows install folder: every `.exe` but the uninstaller. */
function windowsExecutables(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter((name) => /\.exe$/i.test(name) && !/^Uninstall /i.test(name))
}

/** Extracts the AppImage; the editor runs from `squashfs-root` with `--no-sandbox`. */
function installLinux(installer, work) {
  const copy = join(work, basename(installer))
  copyFileSync(installer, copy)
  chmodSync(copy, 0o755)
  mustRun(copy, ['--appimage-extract'], { cwd: work, stdio: 'ignore', timeout: CLI_INSTALL_MS })
  const root = join(work, 'squashfs-root')
  const helpers = new Set(['AppRun', 'chrome-sandbox', 'chrome_crashpad_handler'])
  const executables = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !helpers.has(entry.name) && !/\.so(\.|$)/.test(entry.name))
    .map((entry) => entry.name)
    .filter((name) => (statSync(join(root, name)).mode & 0o111) !== 0 && isElf(join(root, name)))
  if (executables.length !== 1) {
    throw new Error(`squashfs-root holds ${executables.length} editor executables: ${executables.join(', ')}`)
  }
  const resourcesDir = join(root, 'resources')
  return {
    executable: join(root, executables[0]),
    resourcesDir,
    archive: join(resourcesDir, 'app.asar'),
    root,
    baseArgs: ['--no-sandbox'],
    detail: `extracted the AppImage, executable ${executables[0]}`,
    uninstall: () => undefined,
  }
}

/**
 * Starts the installed editor's GUI with a fresh user data folder and observes it; `userDataEntries` counts what the
 * process wrote to that folder, which tells a running editor from a process held before it ran.
 * @param {object} ctx
 * @param {{ leadingArgs?: string[], env?: Record<string, string>, windowMs?: number }} [options]
 */
async function startEditor(ctx, { leadingArgs = [], env = {}, windowMs = START_WINDOW_MS } = {}) {
  const userData = newDir(ctx, 'user-data')
  const observed = await observeStart({
    command: ctx.app.executable,
    args: [...leadingArgs, ...ctx.app.baseArgs, `--user-data-dir=${userData}`],
    env: editorEnv(env),
    cwd: ctx.work,
    windowMs,
  })
  return { ...observed, userDataEntries: readdirSync(userData).length }
}

/** The verdict of an observed start, with the user data entries when the editor was started by `startEditor`. */
function startNote(observed) {
  const entries = observed.userDataEntries === undefined ? '' : `, user data ${observed.userDataEntries} entries`
  return `verdict ${observed.verdict}${entries}`
}

/** Runs the installed editor's command line with a user data folder. */
function runEditorCli(ctx, args, userDataDir, timeoutMs) {
  return runCommand({
    command: ctx.app.executable,
    args: [...ctx.app.baseArgs, '--cli', ...args, '--user-data', userDataDir],
    env: editorEnv(),
    cwd: ctx.work,
    timeoutMs,
  })
}

/** A new empty folder under the run's work folder. */
function newDir(ctx, prefix) {
  ctx.dirs += 1
  const dir = join(ctx.work, `${prefix}-${ctx.dirs}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** The last JSON document a command line run printed on stdout, or null. */
function cliResult(stdout) {
  const line = stdout
    .split(/\r?\n/)
    .map((text) => text.trim())
    .filter((text) => text.startsWith('{'))
    .pop()
  if (line === undefined) return null
  try {
    return JSON.parse(line)
  } catch {
    return null
  }
}

/** The package ids `openplc-cli packages list` reports for a user data folder, or null when it reports none. */
async function listedPackages(ctx, userDataDir) {
  const listed = await runEditorCli(ctx, ['packages', 'list'], userDataDir, CLI_SHORT_MS)
  const packages = cliResult(listed.stdout)?.packages
  return Array.isArray(packages) ? packages.map((entry) => String(entry?.packageId)) : null
}

/** Creates a project with the installed editor's command line and returns its folder. */
async function createProject(ctx, userDataDir) {
  const parent = newDir(ctx, 'projects')
  const created = await runEditorCli(ctx, ['create', PROJECT_NAME, '--path', parent], userDataDir, CLI_SHORT_MS)
  if (created.exitCode !== 0) {
    throw new Error(`openplc-cli create exited ${created.exitCode ?? created.signal}: ${created.stderr.slice(0, 1024)}`)
  }
  return join(parent, PROJECT_NAME)
}

/** Evidence of a process run. */
function evidence(run, detail) {
  return {
    exitCode: run?.exitCode ?? null,
    signal: run?.signal ?? null,
    ms: run?.ms ?? null,
    stderr: Buffer.from(run?.stderr ?? '', 'utf8')
      .subarray(0, EVIDENCE_STDERR)
      .toString('utf8'),
    detail,
  }
}

/** An abuse observation: the attack succeeded or was refused. */
function attack(succeeded, run, detail) {
  return { attackSucceeded: succeeded, evidence: evidence(run, detail) }
}

/** An abuse observation that shows neither the attack nor its refusal. */
function inconclusive(reason, run, detail) {
  return { inconclusive: reason, evidence: evidence(run, detail) }
}

/** A positive-control observation. */
function positive(passed, failure, run, detail) {
  return { positive: passed, failure, evidence: evidence(run, detail) }
}

/** Reduces an observed start: started means the attack worked, not started means it was refused. */
function startAttack(observed, detail) {
  const note = `${detail}; ${startNote(observed)}`
  if (observed.verdict === 'starts') return attack(true, observed, note)
  if (observed.verdict === 'does-not-start') return attack(false, observed, note)
  return inconclusive('the editor exited 0 within the window', observed, note)
}

/** Puts the installation back: the original `app.asar`, no backup, no moved archive and no `resources/app`. */
function restoreInstallation(ctx) {
  const { archive, resourcesDir } = ctx.app
  rmSync(join(resourcesDir, 'app'), { recursive: true, force: true })
  copyFileSync(ctx.originalArchive, archive)
  rmSync(`${archive}.bak`, { force: true })
  rmSync(`${archive}${MOVED_ARCHIVE_SUFFIX}`, { force: true })
  if (sha256File(archive) !== ctx.originalSha) throw new Error(`${archive} could not be restored`)
}

/** Runs the reproducer of the published patch on the installed `app.asar`. */
async function checkPublishedPatch(ctx) {
  const before = sha256File(ctx.app.archive)
  const run = await runCommand({
    command: process.execPath,
    args: [REPRODUCER, ctx.app.archive],
    cwd: process.cwd(),
    timeoutMs: CLI_COMPILE_MS,
  })
  const after = sha256File(ctx.app.archive)
  const detail = `reproducer exit ${run.exitCode ?? run.signal}; app.asar sha256 ${before} -> ${after}`
  const output = `${run.stdout}${run.stderr}`
  if (run.exitCode === 0 && before !== after) return attack(true, run, detail)
  if (run.exitCode === 1 && before === after && output.includes(REPRODUCER_NOT_FOUND)) return attack(false, run, detail)
  return inconclusive('the reproducer neither patched app.asar nor reported the object missing', run, detail)
}

/** Searches the installed tree and the extracted `app.asar` for every trust-anchor literal. */
async function checkLiterals(ctx) {
  const needles = trustNeedles(parseTrustedKeys(readFileSync(ctx.trustedKeys, 'utf8')))
  const extracted = newDir(ctx, 'abuse-02-app-asar')
  extractAsar(ctx.app.archive, extracted)
  try {
    const found = scanPaths([ctx.app.root, extracted], needles)
    const where = [
      ...new Set(found.map((hit) => `${hit.file === hit.root ? hit.file : hit.relative}: ${hit.needle.label}`)),
    ]
    const detail = found.length === 0 ? 'no trust-anchor literal found' : `found ${where.slice(0, 10).join('; ')}`
    return attack(found.length > 0, null, detail)
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
}

/** Changes one byte of the renderer bundle, repacks `app.asar` and starts the editor. */
async function checkRepackedRenderer(ctx) {
  const dir = newDir(ctx, 'abuse-06-row-1')
  const { header } = readAsarHeader(ctx.app.archive)
  extractAsar(ctx.app.archive, dir)
  const renderer = join(dir, 'dist', 'renderer', 'renderer.js')
  const bytes = readFileSync(renderer)
  const edit = whitespaceEdit(bytes)
  bytes[edit.index] = edit.to
  writeFileSync(renderer, bytes)
  const packed = runAsarCli(['pack', dir, ctx.app.archive, ...unpackArgs(header)])
  rmSync(dir, { recursive: true, force: true })
  if (packed.status !== 0) {
    throw new Error(
      `npx asar pack failed (${packed.status ?? packed.signal}): ${packed.stderr || packed.error?.message}`,
    )
  }
  const observed = await startEditor(ctx)
  return startAttack(observed, `changed byte ${edit.index} of dist/renderer/renderer.js and repacked app.asar`)
}

/** Changes one byte of the trust chunk in place, same length, header untouched, and starts the editor. */
async function checkInPlaceEdit(ctx) {
  let chunk
  try {
    chunk = findTrustChunk(ctx.app.archive)
  } catch (error) {
    return inconclusive(error instanceof Error ? error.message : String(error), null, 'no trust chunk found')
  }
  const { headerSize } = readAsarHeader(ctx.app.archive)
  const { offset } = locateFile(ctx.app.archive, chunk.path)
  const edit = whitespaceEdit(readArchiveFile(ctx.app.archive, chunk.path))
  const headerBefore = createHash('sha256')
    .update(readFileSync(ctx.app.archive).subarray(0, 8 + headerSize))
    .digest('hex')
  const lengthBefore = statSync(ctx.app.archive).size
  const fd = openSync(ctx.app.archive, 'r+')
  try {
    writeSync(fd, Buffer.from([edit.to]), 0, 1, offset + edit.index)
  } finally {
    closeSync(fd)
  }
  const headerAfter = createHash('sha256')
    .update(readFileSync(ctx.app.archive).subarray(0, 8 + headerSize))
    .digest('hex')
  if (statSync(ctx.app.archive).size !== lengthBefore || headerAfter !== headerBefore) {
    throw new Error('the in-place edit changed the archive length or its header')
  }
  const observed = await startEditor(ctx)
  return startAttack(observed, `edited ${chunk.path} (${chunk.reason}), byte ${edit.index}`)
}

/** Starts the editor with `ELECTRON_RUN_AS_NODE=1` and a script that writes a marker. */
async function checkRunAsNode(ctx) {
  const dir = newDir(ctx, 'abuse-07-run-as-node')
  const marker = join(dir, 'marker.txt')
  const script = join(dir, 'inject.js')
  writeFileSync(script, markerScript(marker))
  const observed = await startEditor(ctx, { leadingArgs: [script], env: { ELECTRON_RUN_AS_NODE: '1' } })
  const detail = `${startNote(observed)}; marker ${existsSync(marker) ? 'written' : 'absent'}`
  if (existsSync(marker)) return attack(true, observed, detail)
  if (observed.verdict === 'starts') return attack(false, observed, detail)
  return inconclusive('no marker and the editor did not start', observed, detail)
}

/** Starts the editor with `NODE_OPTIONS=--require` of a script that writes a marker. */
async function checkNodeOptions(ctx) {
  const dir = newDir(ctx, 'abuse-07-node-options')
  const marker = join(dir, 'marker.txt')
  const script = join(dir, 'inject.js')
  writeFileSync(script, markerScript(marker))
  const observed = await startEditor(ctx, { env: { NODE_OPTIONS: `--require ${nodeOptionPath(script)}` } })
  const written = existsSync(marker)
  return attack(written, observed, `${startNote(observed)}; marker ${written ? 'written' : 'absent'}`)
}

/** Starts the editor with an inspector switch on a free port and watches the port and stderr. */
async function checkInspector(ctx, flag) {
  const port = await freePort()
  const observing = startEditor(ctx, { leadingArgs: [`${flag}=${port}`] })
  const portOpened = await watchPort(port, observing)
  const observed = await observing
  const banner = observed.stderr.includes(INSPECTOR_BANNER)
  const detail = `port ${port} ${portOpened ? 'accepted a connection' : 'stayed closed'}; ${
    banner ? 'inspector banner on stderr' : 'no inspector banner'
  }; ${startNote(observed)}`
  if (portOpened || banner) return attack(true, observed, detail)
  if (flag === '--inspect' || observed.verdict === 'starts') return attack(false, observed, detail)
  return inconclusive('no inspector and the editor did not start', observed, detail)
}

/** Sends SIGUSR1 to the running editor and watches stderr for the inspector banner. */
async function checkSigusr1(ctx) {
  const run = launch({
    command: ctx.app.executable,
    args: [...ctx.app.baseArgs, `--user-data-dir=${newDir(ctx, 'user-data')}`],
    env: editorEnv(),
    cwd: ctx.work,
  })
  try {
    const early = await raceTimeout(run.ended, SIGUSR1_SETTLE_MS)
    if (early !== undefined) {
      await run.drained()
      return inconclusive('the editor ended before the signal', { ...early, stderr: run.stderr() }, 'no signal sent')
    }
    process.kill(run.child.pid, 'SIGUSR1')
    const after = await raceTimeout(run.ended, SIGUSR1_WATCH_MS)
    if (after !== undefined) await run.drained()
    const banner = run.stderr().includes(INSPECTOR_BANNER)
    const observed = after ?? { exitCode: null, signal: null, ms: Date.now() - run.startedAt }
    const detail = `SIGUSR1 sent after ${SIGUSR1_SETTLE_MS} ms; ${banner ? 'inspector banner on stderr' : 'no inspector banner'}; ${
      after === undefined ? 'still running' : `ended by ${after.signal ?? `exit code ${after.exitCode}`}`
    }`
    if (banner) return attack(true, { ...observed, stderr: run.stderr() }, detail)
    if (after === undefined || after.signal === 'SIGUSR1') {
      return attack(false, { ...observed, stderr: run.stderr() }, detail)
    }
    return inconclusive(
      'the editor died after the signal by another cause',
      { ...observed, stderr: run.stderr() },
      detail,
    )
  } finally {
    await run.stop()
  }
}

/** Extracts `app.asar` to `resources/app` with a main script writing a marker, optionally moving `app.asar` away. */
async function checkAppFolder(ctx, moveArchive) {
  const appDir = join(ctx.app.resourcesDir, 'app')
  const marker = join(newDir(ctx, 'abuse-13'), 'marker.txt')
  extractAsar(ctx.app.archive, appDir)
  const main = JSON.parse(readFileSync(join(appDir, 'package.json'), 'utf8')).main ?? 'index.js'
  writeFileSync(join(appDir, ...String(main).split('/')), markerScript(marker, "require('electron').app.exit(0)\n"))
  if (moveArchive) renameSync(ctx.app.archive, `${ctx.app.archive}${MOVED_ARCHIVE_SUFFIX}`)
  const observed = await startEditor(ctx)
  const written = existsSync(marker)
  const detail = `${moveArchive ? 'app.asar renamed' : 'app.asar kept'}; ${startNote(observed)}; marker ${
    written ? 'written' : 'absent'
  }`
  if (written) return attack(true, observed, detail)
  if (observed.verdict === (moveArchive ? 'does-not-start' : 'starts')) return attack(false, observed, detail)
  return inconclusive(
    moveArchive ? 'no marker but the editor did not fail to start' : 'no marker and the editor did not start',
    observed,
    detail,
  )
}

/** Offers the third-party package to `openplc-cli packages install`. */
async function checkCliInstallRefusal(ctx) {
  const vpp = join(newDir(ctx, 'abuse-03-b'), 'eqsp32.vpp')
  writeEqsp32Vpp(vpp)
  const userData = newDir(ctx, 'user-data')
  const run = await runEditorCli(ctx, ['packages', 'install', vpp], userData, CLI_INSTALL_MS)
  const listed = await listedPackages(ctx, userData)
  const detail = `install exit ${run.exitCode ?? (run.timedOut ? 'timeout' : run.signal)}; packages list ${
    listed === null ? 'unreadable' : JSON.stringify(listed)
  }`
  if (run.exitCode === 0 || listed?.includes(EQSP32_PACKAGE_ID)) return attack(true, run, detail)
  if (run.exitCode !== null && run.stderr.includes(IMPORT_REFUSAL) && listed !== null && listed.length === 0) {
    return attack(false, run, detail)
  }
  return inconclusive('the install neither succeeded nor was refused for its signature', run, detail)
}

/** Places the third-party package by hand and compiles a project for its board. */
async function checkCliCompileRefusal(ctx) {
  const vpp = join(newDir(ctx, 'abuse-03-e'), 'eqsp32.vpp')
  const { boardName } = writeEqsp32Vpp(vpp)
  const userData = newDir(ctx, 'user-data')
  placePackageByHand({ vppPath: vpp, userDataDir: userData })
  const project = await createProject(ctx, userData)
  const run = await runEditorCli(ctx, ['compile', project, '--target', boardName], userData, CLI_COMPILE_MS)
  const built = holdsFiles(join(project, 'build'))
  const detail = `compile exit ${run.exitCode ?? (run.timedOut ? 'timeout' : run.signal)}; build output ${
    built ? 'present' : 'absent'
  }`
  if (run.exitCode === 0 || built) return attack(true, run, detail)
  if (run.exitCode !== null && run.stderr.includes(INTEGRITY_REFUSAL) && run.stderr.includes(EQSP32_PACKAGE_ID)) {
    return attack(false, run, detail)
  }
  return inconclusive('the compile neither succeeded nor was refused for the package signature', run, detail)
}

/** Places the fx3u package by hand and compiles a project for its board: the package must stay trusted. */
async function checkCliCompileAccepted(ctx) {
  const userData = newDir(ctx, 'user-data')
  const { packageDir } = placePackageByHand({ vppPath: ctx.positiveControl, userDataDir: userData })
  const project = await createProject(ctx, userData)
  const run = await runEditorCli(ctx, ['compile', project, '--target', FX3U_BOARD], userData, CLI_COMPILE_MS)
  const registryPath = join(userData, 'packages', 'registry.json')
  const registered =
    existsSync(registryPath) && JSON.parse(readFileSync(registryPath, 'utf8')).packages?.[FX3U_PACKAGE_ID]
  const reached = run.stderr.includes(`for ${FX3U_BOARD}`)
  const refused = run.stderr.includes(INTEGRITY_REFUSAL)
  const detail = `compile exit ${run.exitCode ?? (run.timedOut ? 'timeout' : run.signal)}; ${
    reached ? 'build started' : 'build not started'
  }; package folder ${existsSync(packageDir) ? 'kept' : 'gone'}; registry entry ${registered ? 'kept' : 'gone'}`
  const failure = refused
    ? 'the build refused the fx3u package for its signature'
    : !reached
      ? 'the build did not start for the fx3u board'
      : 'the fx3u package was removed'
  return positive(!refused && reached && existsSync(packageDir) && Boolean(registered), failure, run, detail)
}

/** Installs the fx3u package through `openplc-cli packages install`, which downloads its arduino core. */
async function checkCliInstallAccepted(ctx) {
  const userData = newDir(ctx, 'user-data')
  const run = await runEditorCli(ctx, ['packages', 'install', ctx.positiveControl], userData, CLI_INSTALL_MS)
  const installed = cliResult(run.stdout)?.installed
  const named =
    (Array.isArray(installed) && installed.some((entry) => entry?.packageId === FX3U_PACKAGE_ID)) ||
    run.stderr.includes(`installed ${FX3U_PACKAGE_ID}`)
  const detail = `install exit ${run.exitCode ?? (run.timedOut ? 'timeout' : run.signal)}; ${
    named ? `${FX3U_PACKAGE_ID} reported installed` : `${FX3U_PACKAGE_ID} not reported installed`
  }`
  return positive(run.exitCode === 0 && named, 'the fx3u package did not install', run, detail)
}

/** Each check: how it runs and whether it edits the installation. */
const CHECKS = Object.freeze({
  start: {
    edits: false,
    run: async (ctx) => {
      const observed = await startEditor(ctx)
      return positive(
        observed.verdict === 'starts',
        `the editor did not start: ${observed.verdict}`,
        observed,
        `${startNote(observed)}`,
      )
    },
  },
  'ABUSE-01': { edits: true, run: checkPublishedPatch },
  'ABUSE-02': { edits: false, run: checkLiterals },
  'ABUSE-06 row 1': { edits: true, run: checkRepackedRenderer },
  'ABUSE-06 row 2': { edits: true, run: checkInPlaceEdit },
  'ABUSE-07 ELECTRON_RUN_AS_NODE': { edits: false, run: checkRunAsNode },
  'ABUSE-07 NODE_OPTIONS': { edits: false, run: checkNodeOptions },
  'ABUSE-07 --inspect': { edits: false, run: (ctx) => checkInspector(ctx, '--inspect') },
  'ABUSE-07 --inspect-brk': { edits: false, run: (ctx) => checkInspector(ctx, '--inspect-brk') },
  'ABUSE-07 SIGUSR1': { edits: false, run: checkSigusr1 },
  'ABUSE-13 (a)': { edits: true, run: (ctx) => checkAppFolder(ctx, false) },
  'ABUSE-13 (b)': { edits: true, run: (ctx) => checkAppFolder(ctx, true) },
  'ABUSE-03 (b)': { edits: false, run: checkCliInstallRefusal },
  'ABUSE-03 (e)': { edits: false, run: checkCliCompileRefusal },
  'AC5 compile': { edits: false, run: checkCliCompileAccepted },
  'AC5 packages install': { edits: false, run: checkCliInstallAccepted },
})

/**
 * The report entry of one planned check.
 * @param {{ id: string, mode: string, reason?: string }} planned
 * @param {object} observation
 */
function reportEntry(planned, observation) {
  if (observation.inconclusive !== undefined) {
    return {
      id: planned.id,
      mode: planned.mode,
      result: 'fail',
      reason: `inconclusive: ${observation.inconclusive}`,
      evidence: observation.evidence,
    }
  }
  if (observation.positive !== undefined) {
    return {
      id: planned.id,
      mode: planned.mode,
      result: observation.positive ? 'pass' : 'fail',
      reason: observation.positive ? null : observation.failure,
      evidence: observation.evidence,
    }
  }
  const result = judge({ mode: planned.mode, attackSucceeded: observation.attackSucceeded })
  let reason = null
  if (result === 'fail') {
    reason = planned.mode === 'normal' ? 'the attack succeeded' : 'the attack did not show on the original installer'
  }
  return { id: planned.id, mode: planned.mode, result, reason, evidence: observation.evidence }
}

/** A failed report entry for a check that could not run. */
function errorEntry(planned, error) {
  const message = error instanceof Error ? error.message : String(error)
  return {
    id: planned.id,
    mode: planned.mode,
    result: 'fail',
    reason: `error: ${message}`,
    evidence: evidence(null, message),
  }
}

/**
 * Installs the editor, runs every planned check against it and returns the report.
 * @param {{ platform: string, installer: string, version: string, positiveControl: string, trustedKeys: string,
 *   negativeControl: boolean }} options
 */
async function runChecks(options) {
  const startedAt = new Date().toISOString()
  const plan = planChecks(options)
  const work = mkdtempSync(join(realpathSync(tmpdir()), 'packaged-checks-'))
  const ctx = {
    work,
    dirs: 0,
    trustedKeys: options.trustedKeys,
    positiveControl: options.positiveControl,
    app: null,
    originalArchive: join(work, 'original-app.asar'),
    originalSha: '',
  }
  const checks = []
  try {
    let installError = null
    try {
      ctx.app = installEditor(options.platform, options.installer, work)
      copyFileSync(ctx.app.archive, ctx.originalArchive)
      ctx.originalSha = sha256File(ctx.originalArchive)
      console.error(`installed: ${ctx.app.detail}`)
    } catch (error) {
      installError = new Error(`install failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const planned of plan) {
      if (planned.mode === 'skipped') {
        checks.push({ id: planned.id, mode: 'skipped', result: 'skipped', reason: planned.reason, evidence: null })
        continue
      }
      if (installError !== null) {
        checks.push(errorEntry(planned, installError))
        continue
      }
      const check = CHECKS[planned.id]
      let entry
      try {
        entry = reportEntry(planned, await check.run(ctx))
      } catch (error) {
        entry = errorEntry(planned, error)
      } finally {
        if (check.edits) {
          try {
            restoreInstallation(ctx)
          } catch (error) {
            installError = error instanceof Error ? error : new Error(String(error))
          }
        }
      }
      checks.push(entry)
      console.error(
        `${entry.result.padEnd(7)} ${planned.id} (${planned.mode})${entry.reason ? `: ${entry.reason}` : ''}`,
      )
    }
  } finally {
    for (const child of running) killTree(child)
    try {
      ctx.app?.uninstall()
    } finally {
      rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 })
    }
  }
  return {
    schema: 1,
    platform: options.platform,
    version: options.version,
    installer: basename(options.installer),
    installerSha256: sha256File(options.installer),
    negativeControl: options.negativeControl,
    startedAt,
    finishedAt: new Date().toISOString(),
    result: checks.some((entry) => entry.result === 'fail') ? 'fail' : 'pass',
    checks,
  }
}

/**
 * Reads and checks the command line; every problem is collected before anything is installed.
 * @param {string[]} argv
 * @throws {CheckFailure} listing each problem.
 */
function readOptions(argv) {
  const { values, positionals } = parseCli(
    {
      platform: { type: 'string' },
      installer: { type: 'string' },
      version: { type: 'string' },
      'positive-control': { type: 'string' },
      'trusted-keys': { type: 'string' },
      report: { type: 'string' },
      'negative-control': { type: 'boolean' },
    },
    ['platform', 'installer', 'version', 'positive-control', 'trusted-keys', 'report'],
    argv,
  )
  const problems = positionals.map((value) => `unexpected argument ${JSON.stringify(value)}`)
  if (!PLATFORMS.includes(values.platform)) {
    problems.push(`--platform: unknown platform ${JSON.stringify(values.platform)}, expected ${PLATFORMS.join(', ')}`)
  }
  if (!VERSION.test(values.version))
    problems.push(`--version: ${JSON.stringify(values.version)} is not <major>.<minor>.<patch>`)
  for (const option of ['installer', 'positive-control', 'trusted-keys']) {
    if (!isFile(values[option])) problems.push(`--${option}: ${values[option]} is not a file`)
  }
  if (isFile(values['positive-control'])) {
    const digest = sha256File(values['positive-control'])
    if (digest !== FX3U_SHA256) {
      problems.push(
        `--positive-control: ${values['positive-control']} has sha256 ${digest}, not the pinned fx3u package ${FX3U_SHA256}`,
      )
    }
  }
  if (isFile(values['trusted-keys'])) {
    try {
      parseTrustedKeys(readFileSync(values['trusted-keys'], 'utf8'))
    } catch (error) {
      problems.push(
        `--trusted-keys: ${values['trusted-keys']}: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  if (!existsSync(dirname(values.report))) problems.push(`--report: the folder of ${values.report} does not exist`)
  if (problems.length > 0) throw new CheckFailure(problems)
  return {
    platform: values.platform,
    installer: values.installer,
    version: values.version,
    positiveControl: values['positive-control'],
    trustedKeys: values['trusted-keys'],
    report: values.report,
    negativeControl: values['negative-control'] === true,
  }
}

/**
 * The command line: 2 for a usage problem (no report), 1 when a check fails, 0 when every check passes or is skipped.
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  let options
  try {
    options = readOptions(argv)
  } catch (error) {
    const lines =
      error instanceof CheckFailure ? error.problems : [error instanceof Error ? error.message : String(error)]
    for (const line of lines) console.error(line)
    console.error(
      'usage: packaged-checks.mjs --platform <mac|win|linux> --installer <path> --version <v> --positive-control <fx3u .vpp> --trusted-keys <trusted-keys.ts> --report <file.json> [--negative-control]',
    )
    return 2
  }
  const report = await runChecks(options)
  writeFileSync(options.report, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`${report.result}: ${options.report}`)
  return report.result === 'pass' ? 0 : 1
}

/** True when this file is the script Node was asked to run, rather than a module imported by another. */
function isEntryPoint() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code
    },
    (error) => {
      for (const child of running) killTree(child)
      console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
      process.exitCode = 1
    },
  )
}
