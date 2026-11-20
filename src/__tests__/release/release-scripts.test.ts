/**
 * The release check scripts of `scripts/release/`, each run as a CI step runs it: one Node process per call, over
 * files written to a temporary directory. Fuse wires, keys, digests, archives and packages are synthetic, so no
 * Electron binary and no installer is needed.
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process'
import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { finished } from 'node:stream/promises'
import { pathToFileURL } from 'node:url'

import { createPackage, createPackageWithOptions, extractFile, getRawHeader, uncacheAll } from '@electron/asar'
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'
import { verifyPackageSignature } from '@root/backend/shared/utils/vpp/verify-package-signature'
import { PackageManifestSchema } from '@root/middleware/shared/ports/package-manifest-schema'
import extract from 'extract-zip'
import JSZip from 'jszip'

const repo = join(__dirname, '..', '..', '..')
const scripts = join(repo, 'scripts', 'release')

/** Exit status and output of one script run; `output` is stdout followed by stderr. Both are read as latin1. */
type Run = { status: number; stdout: string; output: string }

/** Options of one Node process run: its working directory, environment and a kill timeout in milliseconds. */
type RunOptions = { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number }

let root = ''
let calls = 0

beforeEach(() => {
  root = mkdtempSync(join(realpathSync(tmpdir()), 'release-scripts-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function readField(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? Reflect.get(value, key) : undefined
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value
  return Buffer.isBuffer(value) ? value.toString('latin1') : ''
}

function node(args: string[], options: RunOptions = {}): Run {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      encoding: 'latin1',
      stdio: 'pipe',
      timeout: options.timeout,
    })
    return { status: 0, stdout, output: stdout }
  } catch (error) {
    const status = readField(error, 'status')
    const stdout = asText(readField(error, 'stdout'))
    return {
      status: typeof status === 'number' ? status : -1,
      stdout,
      output: `${stdout}${asText(readField(error, 'stderr'))}`,
    }
  }
}

function run(script: string, args: string[], options: RunOptions = {}): Run {
  return node([join(scripts, script), ...args], options)
}

/**
 * Evaluates @p expression, with the ES module bound to `lib`, in its own Node process and awaits its result, which is
 * written to a JSON file so the module's own console output cannot mix with it.
 * @returns `{ value }` with the JSON round trip of the result, `{ refused }` with the message of a thrown error, or
 * `{ failure }` with the process output when the module could not be run at all.
 */
function evaluateWith(module: string, expression: string, options: RunOptions = {}): Record<string, unknown> {
  calls += 1
  const out = join(root, `call-${calls}.json`)
  const code = [
    "import { writeFileSync } from 'node:fs'",
    `import * as lib from ${JSON.stringify(pathToFileURL(module).href)}`,
    'let result',
    'try {',
    `  result = { value: (await ${expression}) ?? null }`,
    '} catch (error) {',
    '  result = { refused: error instanceof Error ? error.message : String(error) }',
    '}',
    `writeFileSync(${JSON.stringify(out)}, JSON.stringify(result))`,
  ].join('\n')
  const ran = node(['--input-type=module', '-e', code], options)
  if (ran.status !== 0) return { failure: ran.output }
  const result: unknown = JSON.parse(readFileSync(out, 'utf8'))
  return typeof result === 'object' && result !== null ? Object.fromEntries(Object.entries(result)) : {}
}

/** Calls the named export of an ES module with @p args, as `evaluateWith` runs it. */
function callExport(module: string, name: string, args: unknown[], options: RunOptions = {}): Record<string, unknown> {
  return evaluateWith(module, `lib[${JSON.stringify(name)}](...${JSON.stringify(args)})`, options)
}

/** Reads the named exported value of an ES module, as `evaluateWith` runs it. */
function readExport(module: string, name: string): Record<string, unknown> {
  return evaluateWith(module, `lib[${JSON.stringify(name)}]`)
}

/** An Ed25519 test key: its id, its PEM, the PEM body on one line and its 32 raw bytes. */
type TestKey = { id: string; pem: string; body: string; raw: Buffer }

/** A deterministic Ed25519 public key whose private seed is 32 bytes of @p fill. */
function testKey(id: string, fill: number): TestKey {
  const pkcs8 = concat(Buffer.from('302e020100300506032b657004220420', 'hex'), Buffer.alloc(32, fill))
  const publicKey = createPublicKey(createPrivateKey({ key: pkcs8, format: 'der', type: 'pkcs8' }))
  const pem = String(publicKey.export({ type: 'spki', format: 'pem' }))
  const body = pem
    .split('\n')
    .filter((line) => line !== '' && !line.startsWith('-----'))
    .join('')
  return { id, pem, body, raw: publicKey.export({ type: 'spki', format: 'der' }).subarray(12) }
}

/**
 * Packs @p files with @electron/asar into `<name>/resources/app.asar` under the temp dir and returns its path; files
 * matching the @p unpack glob go to `app.asar.unpacked`.
 */
async function packApp(files: Record<string, string>, name = 'installed', unpack?: string): Promise<string> {
  const source = join(root, `${name}-source`)
  for (const [path, content] of Object.entries(files)) write(join(source, ...path.split('/')), content)
  const archive = join(root, name, 'resources', 'app.asar')
  mkdirSync(dirname(archive), { recursive: true })
  const stream = unpack ? createPackageWithOptions(source, archive, { unpack }) : createPackage(source, archive)
  await finished(await stream)
  uncacheAll()
  return archive
}

/** Every regular file under @p dir, as sorted POSIX paths relative to it. */
function listTree(dir: string, under = dir): string[] {
  return readdirSync(under, { withFileTypes: true })
    .flatMap((entry) => {
      const path = join(under, entry.name)
      if (entry.isDirectory()) return listTree(dir, path)
      return entry.isFile() ? [relative(dir, path).split(sep).join('/')] : []
    })
    .sort()
}

/** Joins byte chunks; each is copied into a plain Uint8Array, the type the Node APIs here are declared with. */
function concat(...parts: Buffer[]): Buffer {
  return Buffer.concat(parts.map((part) => Uint8Array.from(part)))
}

function write(path: string, content: string | Buffer): string {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof content === 'string' ? content : Uint8Array.from(content))
  return path
}

function writeJson(path: string, value: unknown): string {
  return write(path, `${JSON.stringify(value, null, 2)}\n`)
}

/** True when one line of the output holds every part. */
function lineWith(output: string, ...parts: string[]): boolean {
  return output.split(/\r?\n/).some((line) => parts.every((part) => line.includes(part)))
}

function sha256(content: string | Buffer): string {
  return createHash('sha256')
    .update(typeof content === 'string' ? content : Uint8Array.from(content))
    .digest('hex')
}

/** The six installer names of a release, as the contract lists them. */
function assetNames(version: string): string[] {
  return [
    `OpenPLC.Editor-${version}.AppImage`,
    `OpenPLC.Editor-${version}-ARM64.AppImage`,
    `OpenPLC.Editor_${version}.exe`,
    `OpenPLC.Editor_${version}-ARM64.exe`,
    `OpenPLC_Editor_${version}.dmg`,
    `OpenPLC_Editor_${version}-ARM.dmg`,
  ]
}

const VERSION = '4.3.5'
const NAMES = assetNames(VERSION)

describe('lib/release-assets.mjs', () => {
  const lib = join(scripts, 'lib', 'release-assets.mjs')

  function call(name: 'versionFromReleaseTag' | 'expectedAssetNames', arg: string): Record<string, unknown> {
    return callExport(lib, name, [arg])
  }

  it.each([
    ['v4.3.5', '4.3.5'],
    ['v4.3.5-rehearsal', '4.3.5'],
    ['v4.3.0', '4.3.0'],
    ['v10.20.30', '10.20.30'],
  ])('reads the version %s -> %s from a release tag', (tag, version) => {
    expect(call('versionFromReleaseTag', tag)).toEqual({ value: version })
  })

  it.each([
    '4.3.5',
    'v4.3',
    'v4.3.5-rc1',
    'v4.3.5-rehearsal2',
    'v4.3.5-REHEARSAL',
    'V4.3.5',
    'v4.3.5 ',
    'refs/tags/v4.3.5',
    '',
  ])('refuses the release tag %j, naming it', (tag) => {
    const result = call('versionFromReleaseTag', tag)

    expect(Object.keys(result)).toEqual(['refused'])
    expect(String(result.refused)).toContain(tag.trim())
  })

  it.each(['4.3.0', '4.3.5'])('lists exactly the six installer names of %s', (version) => {
    const result = call('expectedAssetNames', version)
    const value = Array.isArray(result.value) ? [...result.value].map(String).sort() : result

    expect(value).toEqual(assetNames(version).sort())
  })
})

describe('check-version.mjs', () => {
  function versionTree(appVersion: string, packageVersion: string): string {
    const tree = join(root, 'tree')
    write(
      join(tree, 'src', 'frontend', 'data', 'constants', 'app-version.ts'),
      `/** OpenPLC application version shown in the About modal of the editor and the web app. */\nexport const APP_VERSION = '${appVersion}'\n`,
    )
    writeJson(join(tree, 'release', 'app', 'package.json'), { name: 'open-plc-editor', version: packageVersion })
    writeJson(join(tree, 'package.json'), { name: 'open-plc-editor', version: '4.3.5' })
    return tree
  }

  it.each(['v4.3.5', 'v4.3.5-rehearsal'])('passes a 4.3.5 tree for %s and prints only the version', (tag) => {
    const result = run('check-version.mjs', ['--release', tag, '--tree', versionTree('4.3.5', '4.3.5')])

    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toBe('4.3.5')
  })

  it('fails a tree whose APP_VERSION is 4.3.4 against v4.3.5-rehearsal, naming 4.3.4 and 4.3.5', () => {
    const result = run('check-version.mjs', ['--release', 'v4.3.5-rehearsal', '--tree', versionTree('4.3.4', '4.3.5')])

    expect(result.status).toBe(1)
    expect(result.output).toContain('4.3.4')
    expect(result.output).toContain('4.3.5')
  })

  it('fails a tree whose release/app/package.json is 4.3.4 against v4.3.5-rehearsal, naming 4.3.4 and 4.3.5', () => {
    const result = run('check-version.mjs', ['--release', 'v4.3.5-rehearsal', '--tree', versionTree('4.3.5', '4.3.4')])

    expect(result.status).toBe(1)
    expect(result.output).toContain('4.3.4')
    expect(result.output).toContain('4.3.5')
  })
})

describe('check-upload-set.mjs', () => {
  function uploadSet(names: string[]): string {
    const dir = join(root, 'upload')
    mkdirSync(dir, { recursive: true })
    for (const name of names) write(join(dir, name), `installer ${name}\n`)
    return dir
  }

  it('passes a directory holding exactly the six installers', () => {
    expect(run('check-upload-set.mjs', ['--version', VERSION, uploadSet(NAMES)]).status).toBe(0)
  })

  it.each([
    ['latest.yml', 'the update metadata electron-builder writes'],
    ['OpenPLC.Editor_4.3.5.exe.blockmap', 'a blockmap'],
    ['OpenPLC Editor_4.3.5.exe', 'a seventh installer'],
  ])('fails the six installers plus %s (%s), naming it', (extra) => {
    const result = run('check-upload-set.mjs', ['--version', VERSION, uploadSet([...NAMES, extra])])

    expect(result.status).toBe(1)
    expect(result.output).toContain(extra)
  })

  it('fails a set missing one installer, naming it', () => {
    const missing = 'OpenPLC.Editor_4.3.5-ARM64.exe'
    const result = run('check-upload-set.mjs', [
      '--version',
      VERSION,
      uploadSet(NAMES.filter((name) => name !== missing)),
    ])

    expect(result.status).toBe(1)
    expect(result.output).toContain(missing)
  })

  it('names every unexpected and every missing file in one run', () => {
    const missing = 'OpenPLC_Editor_4.3.5-ARM.dmg'
    const names = [...NAMES.filter((name) => name !== missing), 'latest.yml', 'latest-mac.yml']
    const result = run('check-upload-set.mjs', ['--version', VERSION, uploadSet(names)])

    expect(result.status).toBe(1)
    expect(result.output).toContain('latest.yml')
    expect(result.output).toContain('latest-mac.yml')
    expect(result.output).toContain(missing)
  })

  it('fails when an expected name is a directory rather than a regular file, naming it', () => {
    const dmg = 'OpenPLC_Editor_4.3.5.dmg'
    const dir = uploadSet(NAMES.filter((name) => name !== dmg))
    mkdirSync(join(dir, dmg))

    const result = run('check-upload-set.mjs', ['--version', VERSION, dir])

    expect(result.status).toBe(1)
    expect(result.output).toContain(dmg)
  })
})

describe('release-digests.mjs', () => {
  const ORIGINAL = Object.fromEntries(NAMES.map((name) => [name, sha256(`original ${name}`)]))
  const BUILT = Object.fromEntries(NAMES.map((name) => [name, sha256(`built ${name}`)]))

  function releaseAssets(digests: Record<string, string>): string {
    const assets = Object.entries(digests).map(([name, hex], index) => ({
      id: 1000 + index,
      name,
      size: 1024 + index,
      digest: `sha256:${hex}`,
      browser_download_url: `https://github.com/Autonomy-Logic/openplc-editor/releases/download/v4.3.5-rehearsal/${encodeURIComponent(name)}`,
    }))
    return writeJson(join(root, 'release-assets.json'), assets)
  }

  function without(digests: Record<string, string>, name: string): Record<string, string> {
    return Object.fromEntries(Object.entries(digests).filter(([key]) => key !== name))
  }

  function before(digests: Record<string, string>): Run {
    const args = [
      'before',
      '--version',
      VERSION,
      '--assets',
      releaseAssets(digests),
      '--out',
      join(root, 'original.json'),
    ]
    return run('release-digests.mjs', args)
  }

  function after(digests: Record<string, string>, built: Record<string, string> = BUILT): Run {
    const args = [
      'after',
      '--version',
      VERSION,
      '--assets',
      releaseAssets(digests),
      '--built',
      writeJson(join(root, 'built.json'), built),
      '--original',
      writeJson(join(root, 'original.json'), ORIGINAL),
    ]
    return run('release-digests.mjs', args)
  }

  describe('before', () => {
    it('writes the sha256 of each of the six release assets', () => {
      const result = before(ORIGINAL)

      expect(result.status).toBe(0)
      expect(JSON.parse(readFileSync(join(root, 'original.json'), 'utf8'))).toStrictEqual(ORIGINAL)
    })

    it('fails a release missing one installer, naming it', () => {
      const result = before(without(ORIGINAL, 'OpenPLC.Editor_4.3.5-ARM64.exe'))

      expect(result.status).toBe(1)
      expect(result.output).toContain('OpenPLC.Editor_4.3.5-ARM64.exe')
    })

    it('fails a release holding a seventh asset, naming it', () => {
      const result = before({ ...ORIGINAL, 'OpenPLC Editor_4.3.5.exe': sha256('seventh') })

      expect(result.status).toBe(1)
      expect(result.output).toContain('OpenPLC Editor_4.3.5.exe')
    })
  })

  describe('after', () => {
    it('passes when the release holds the six installers, each with its build digest', () => {
      expect(after(BUILT).status).toBe(0)
    })

    it('fails an installer the run did not build, naming it as differing from the build (ABUSE-10)', () => {
      const result = after({ ...BUILT, 'OpenPLC.Editor_4.3.5.exe': sha256('tampered installer') })

      expect(result.status).toBe(1)
      expect(lineWith(result.output, 'OpenPLC.Editor_4.3.5.exe', 'digest differs from the build')).toBe(true)
    })

    it('fails an installer that was not replaced, naming it as still carrying its original digest (ABUSE-12)', () => {
      const name = 'OpenPLC.Editor-4.3.5-ARM64.AppImage'
      const result = after({ ...BUILT, [name]: ORIGINAL[name] })

      expect(result.status).toBe(1)
      expect(lineWith(result.output, name, 'still carrying its original digest')).toBe(true)
    })

    it('fails a missing installer, naming it as missing (ABUSE-12)', () => {
      const name = 'OpenPLC.Editor_4.3.5-ARM64.exe'
      const result = after(without(BUILT, name))

      expect(result.status).toBe(1)
      expect(lineWith(result.output, name, 'missing')).toBe(true)
    })

    it('fails a seventh asset, naming it as unexpected (ABUSE-12)', () => {
      const name = 'OpenPLC Editor_4.3.5.exe'
      const result = after({ ...BUILT, [name]: sha256('seventh') })

      expect(result.status).toBe(1)
      expect(lineWith(result.output, name, 'unexpected')).toBe(true)
    })

    it('names each failing asset with its own reason in one run', () => {
      const result = after({
        ...without(BUILT, 'OpenPLC.Editor_4.3.5-ARM64.exe'),
        'OpenPLC.Editor_4.3.5.exe': sha256('tampered installer'),
        'OpenPLC.Editor-4.3.5-ARM64.AppImage': ORIGINAL['OpenPLC.Editor-4.3.5-ARM64.AppImage'],
        'OpenPLC Editor_4.3.5.exe': sha256('seventh'),
      })

      expect(result.status).toBe(1)
      expect([
        lineWith(result.output, 'OpenPLC.Editor_4.3.5.exe', 'digest differs from the build'),
        lineWith(result.output, 'OpenPLC.Editor-4.3.5-ARM64.AppImage', 'still carrying its original digest'),
        lineWith(result.output, 'OpenPLC.Editor_4.3.5-ARM64.exe', 'missing'),
        lineWith(result.output, 'OpenPLC Editor_4.3.5.exe', 'unexpected'),
      ]).toEqual([true, true, true, true])
    })

    it('fails an installer whose build digest equals its original one, as still carrying its original digest', () => {
      const name = 'OpenPLC_Editor_4.3.5.dmg'
      const built = { ...BUILT, [name]: ORIGINAL[name] }
      const result = after(built, built)

      expect(result.status).toBe(1)
      expect(lineWith(result.output, name, 'still carrying its original digest')).toBe(true)
    })
  })
})

describe('read-fuses.mjs', () => {
  const SENTINEL = 'dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX'
  const OFF = 0x30
  const ON = 0x31
  const REMOVED = 0x72
  const HARDENED = [OFF, OFF, OFF, OFF, ON, ON, OFF, ON]
  const ELECTRON_DEFAULT = [ON, OFF, ON, ON, OFF, OFF, OFF, ON]
  const CHECKED: [string, number, number][] = [
    ['RunAsNode', 0, ON],
    ['EnableNodeOptionsEnvironmentVariable', 2, ON],
    ['EnableNodeCliInspectArguments', 3, ON],
    ['EnableEmbeddedAsarIntegrityValidation', 4, OFF],
    ['OnlyLoadAppFromAsar', 5, OFF],
  ]

  function wire(states: number[]): Buffer {
    return concat(Buffer.from(SENTINEL, 'latin1'), Buffer.from([1, states.length, ...states]))
  }

  function binary(...wires: Buffer[]): Buffer {
    const filler = (seed: number): Buffer =>
      Buffer.from(Array.from({ length: 96 }, (_, index) => (seed + index * 7) % 256))
    return concat(...wires.flatMap((entry, index) => [filler(index), entry]), filler(wires.length))
  }

  function withFuse(index: number, state: number): number[] {
    return HARDENED.map((value, position) => (position === index ? state : value))
  }

  it('passes an executable whose wire carries the five fuses', () => {
    const exe = write(join(root, 'win-unpacked', 'OpenPLC Editor.exe'), binary(wire(HARDENED)))

    expect(run('read-fuses.mjs', [exe]).status).toBe(0)
  })

  it.each(CHECKED)('fails an executable whose %s fuse is wrong, naming the path and the fuse', (fuse, index, state) => {
    const exe = write(join(root, 'linux-unpacked', 'open-plc-editor'), binary(wire(withFuse(index, state))))

    const result = run('read-fuses.mjs', [exe])

    expect(result.status).toBe(1)
    expect(result.output).toContain(exe)
    expect(result.output).toContain(fuse)
    expect(CHECKED.map(([name]) => name).filter((name) => name !== fuse && result.output.includes(name))).toEqual([])
  })

  it('fails a removed RunAsNode fuse, naming it', () => {
    const exe = write(join(root, 'open-plc-editor'), binary(wire(withFuse(0, REMOVED))))

    const result = run('read-fuses.mjs', [exe])

    expect(result.status).toBe(1)
    expect(result.output).toContain('RunAsNode')
  })

  it('fails a wire too short to hold OnlyLoadAppFromAsar, naming it', () => {
    const exe = write(join(root, 'open-plc-editor'), binary(wire(HARDENED.slice(0, 5))))

    const result = run('read-fuses.mjs', [exe])

    expect(result.status).toBe(1)
    expect(result.output).toContain('OnlyLoadAppFromAsar')
  })

  it('fails a file with no fuse wire, naming it', () => {
    const exe = write(join(root, 'not-electron'), binary())

    const result = run('read-fuses.mjs', [exe])

    expect(result.status).toBe(1)
    expect(result.output).toContain(exe)
  })

  it.each<[string, number[][]]>([
    ['the second', [HARDENED, ELECTRON_DEFAULT]],
    ['the first', [ELECTRON_DEFAULT, HARDENED]],
  ])('fails a two-slice binary when %s slice is unfused', (_slice, slices) => {
    const exe = write(join(root, 'Electron Framework'), binary(...slices.map(wire)))

    const result = run('read-fuses.mjs', [exe])

    expect(result.status).toBe(1)
    expect(result.output).toContain(exe)
  })

  it('passes a two-slice binary when both slices carry the five fuses', () => {
    const exe = write(join(root, 'Electron Framework'), binary(wire(HARDENED), wire(HARDENED)))

    expect(run('read-fuses.mjs', [exe]).status).toBe(0)
  })

  it("fails Electron's default wire, naming the fuses it leaves unset", () => {
    const exe = write(join(root, 'OpenPLC Editor.exe'), binary(wire(ELECTRON_DEFAULT)))

    const result = run('read-fuses.mjs', [exe])

    expect(result.status).toBe(1)
    expect(CHECKED.map(([name]) => name).filter((name) => !result.output.includes(name))).toEqual([])
  })

  it('names only the unfused executable when a good one and an unfused one are read together (ABUSE-15)', () => {
    const good = write(join(root, 'rebuilt', 'OpenPLC Editor.exe'), binary(wire(HARDENED)))
    const original = write(join(root, 'original', 'OpenPLC Editor.exe'), binary(wire(ELECTRON_DEFAULT)))

    const result = run('read-fuses.mjs', [good, original])

    expect(result.status).toBe(1)
    expect(result.output).toContain(original)
    expect(result.output).not.toContain(good)
  })

  describe('a macOS .app bundle', () => {
    const framework = ['Contents', 'Frameworks', 'Electron Framework.framework', 'Electron Framework']

    function bundle(frameworkWire: number[], executableWire: number[]): string {
      const app = join(root, 'mac-arm64', 'OpenPLC Editor.app')
      write(join(app, ...framework), binary(wire(frameworkWire)))
      write(join(app, 'Contents', 'MacOS', 'OpenPLC Editor'), binary(wire(executableWire)))
      return app
    }

    it('passes when Electron Framework carries the five fuses, whatever the main executable holds', () => {
      expect(run('read-fuses.mjs', [bundle(HARDENED, ELECTRON_DEFAULT)]).status).toBe(0)
    })

    it('fails when Electron Framework is unfused, naming the bundle', () => {
      const app = bundle(ELECTRON_DEFAULT, HARDENED)

      const result = run('read-fuses.mjs', [app])

      expect(result.status).toBe(1)
      expect(result.output).toContain(app)
      expect(result.output).toContain('RunAsNode')
    })

    const posix = process.platform === 'win32' ? it.skip : it

    posix('follows the framework symlinks of a real bundle to Versions/A', () => {
      const app = join(root, 'mac', 'OpenPLC Editor.app')
      const frameworkDir = join(app, 'Contents', 'Frameworks', 'Electron Framework.framework')
      write(join(frameworkDir, 'Versions', 'A', 'Electron Framework'), binary(wire(ELECTRON_DEFAULT)))
      symlinkSync('A', join(frameworkDir, 'Versions', 'Current'))
      symlinkSync(join('Versions', 'Current', 'Electron Framework'), join(frameworkDir, 'Electron Framework'))

      const result = run('read-fuses.mjs', [app])

      expect(result.status).toBe(1)
      expect(result.output).toContain(app)
      expect(result.output).toContain('RunAsNode')
    })
  })
})

describe('scan-trust-literals.mjs', () => {
  const BEGIN = '-----BEGIN PUBLIC KEY-----'

  const KEY_A = testKey('vendor-alpha-2026', 0x11)
  const KEY_B = testKey('vendor-beta-2027', 0x22)

  function trustedKeys(): string {
    const entries = [KEY_A, KEY_B].map((key) => `  '${key.id}': \`${key.pem}\`,`).join('\n')
    return write(
      join(root, 'keys', 'trusted-keys.ts'),
      `/**\n * Trusted VPP package-signing public keys.\n */\n\nexport const TRUSTED_PACKAGE_KEYS: Record<string, string> = {\n${entries}\n}\n`,
    )
  }

  function asarLike(payload: Buffer): Buffer {
    const header = Buffer.from(JSON.stringify({ files: { 'main.js': { size: payload.length, offset: '0' } } }))
    return concat(Buffer.from([4, 0, 0, 0, header.length + 8, 0, 0, 0]), header, payload)
  }

  function unpacked(name = 'linux-unpacked'): string {
    const dir = join(root, name)
    write(join(dir, 'open-plc-editor'), Buffer.from(Array.from({ length: 512 }, (_, index) => (index * 31) % 256)))
    write(join(dir, 'resources', 'app.asar'), asarLike(Buffer.from('module.exports = { verify: () => true }\n')))
    write(join(dir, 'resources', 'app.asar.unpacked', 'native.node'), Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]))
    writeJson(join(dir, 'resources', 'app', 'main.js.map'), { version: 3, sources: ['main.ts'], mappings: 'AAAA' })
    write(join(dir, 'LICENSE.electron.txt'), 'Copyright (c) Electron contributors\n')
    return dir
  }

  function scan(dirs: string[], allowed: string[] = [], cwd?: string): Run {
    const allow = allowed.flatMap((path) => ['--allow-begin-marker', path])
    return run('scan-trust-literals.mjs', ['--trusted-keys', trustedKeys(), ...allow, ...dirs], { cwd })
  }

  it('passes an unpacked output that holds no trust literal', () => {
    expect(scan([unpacked()]).status).toBe(0)
  })

  it.each<[string, string, () => string | Buffer]>([
    ['the key id', 'resources/app/key-id.js', () => `const keyId = '${KEY_A.id}'\n`],
    ['the BEGIN marker', 'resources/app/marker.js', () => `const header = '${BEGIN}'\n`],
    [
      'the PEM body on its own lines',
      'resources/app/pem-lines.js',
      () => `const k = \`\n${KEY_A.pem.split('\n')[1]}\n\`\n`,
    ],
    ['the PEM body joined to one line', 'resources/app/pem-joined.js', () => `const k = "${KEY_A.body}"\n`],
    [
      'the PEM JSON-escaped, in a source map',
      'resources/app/escaped.js.map',
      () => JSON.stringify({ sourcesContent: ['const k = `' + KEY_A.pem.split('\n').slice(1).join('\n') + '`'] }),
    ],
    ['the raw key bytes, inside app.asar', 'resources/app.asar', () => asarLike(concat(Buffer.from('k='), KEY_A.raw))],
    [
      'the key bytes as lowercase hex',
      'resources/app/hex-lower.js',
      () => `const k = '${KEY_A.raw.toString('hex')}'\n`,
    ],
    [
      'the key bytes as uppercase hex',
      'resources/app.asar.unpacked/hex-upper.txt',
      () => KEY_A.raw.toString('hex').toUpperCase(),
    ],
    [
      'the key bytes as base64, in a source map',
      'resources/app/base64.js.map',
      () => JSON.stringify({ sourcesContent: [`const k = '${KEY_A.raw.toString('base64')}'`] }),
    ],
  ])('fails on %s, naming the file', (_needle, relative, content) => {
    const dir = unpacked()
    write(join(dir, ...relative.split('/')), content())

    const result = scan([dir])

    expect(result.status).toBe(1)
    expect(result.output).toContain(basename(relative))
  })

  it('fails on a literal of any key of the map, not only the first one', () => {
    const dir = unpacked()
    write(join(dir, 'resources', 'app', 'second-key.js'), `const k = '${KEY_B.raw.toString('hex')}'\n`)

    const result = scan([dir])

    expect(result.status).toBe(1)
    expect(result.output).toContain('second-key.js')
  })

  it('scans every directory it is given', () => {
    const clean = unpacked('win-unpacked')
    const dirty = unpacked('win-arm64-unpacked')
    write(join(dirty, 'resources', 'app', 'late.js'), `const keyId = '${KEY_A.id}'\n`)

    const result = scan([clean, dirty])

    expect(result.status).toBe(1)
    expect(result.output).toContain('late.js')
  })

  describe('--allow-begin-marker', () => {
    it('allows the BEGIN marker in the file it names', () => {
      const dir = unpacked()
      write(join(dir, 'resources', 'app.asar'), asarLike(Buffer.from(`const pem = /${BEGIN}/\n`)))

      expect(scan([dir], ['resources/app.asar'], dir).status).toBe(0)
    })

    it('still fails on the BEGIN marker in any other file, naming only that file', () => {
      const dir = unpacked()
      write(join(dir, 'resources', 'app.asar'), asarLike(Buffer.from(`const pem = /${BEGIN}/\n`)))
      write(join(dir, 'resources', 'app', 'other.js'), `const header = '${BEGIN}'\n`)

      const result = scan([dir], ['resources/app.asar'], dir)

      expect(result.status).toBe(1)
      expect(result.output).toContain('other.js')
      expect(result.output).not.toContain('app.asar')
    })

    it('never allows a key id in the file it names', () => {
      const dir = unpacked()
      write(
        join(dir, 'resources', 'app.asar'),
        asarLike(Buffer.from(`const pem = /${BEGIN}/; const id = '${KEY_A.id}'\n`)),
      )

      const result = scan([dir], ['resources/app.asar'], dir)

      expect(result.status).toBe(1)
      expect(result.output).toContain('app.asar')
    })

    it('never allows a JSON-escaped PEM in the file it names', () => {
      const dir = unpacked()
      write(join(dir, 'resources', 'app.asar'), asarLike(Buffer.from(`const pem = ${JSON.stringify(KEY_A.pem)}\n`)))

      const result = scan([dir], ['resources/app.asar'], dir)

      expect(result.status).toBe(1)
      expect(result.output).toContain('app.asar')
    })
  })
})

describe('release-notes.mjs', () => {
  const ORIGINAL = Object.fromEntries(NAMES.map((name) => [name, sha256(`original ${name}`)]))
  const FIRST = Object.fromEntries(NAMES.map((name) => [name, sha256(`first rebuild ${name}`)]))
  const SECOND = Object.fromEntries(NAMES.map((name) => [name, sha256(`second rebuild ${name}`)]))
  const BODY = "## What's Changed\n* Build with STruC++ v0.8.0 and release as 4.3.5\n"
  const FIRST_COMMIT = 'b657afce48407566c1bcba9d94cb9fe359855428'
  const SECOND_COMMIT = '0123456789abcdef0123456789abcdef01234567'

  function notes(
    body: string,
    date: string,
    commit: string,
    original: Record<string, string>,
    built: Record<string, string>,
  ): Run {
    return run('release-notes.mjs', [
      '--body',
      write(join(root, 'current.md'), body),
      '--date',
      date,
      '--commit',
      commit,
      '--original',
      writeJson(join(root, 'original.json'), original),
      '--built',
      writeJson(join(root, 'built.json'), built),
    ])
  }

  it('prints the current body unchanged, followed by the section of this rebuild', () => {
    const result = notes(BODY, '2026-11-19', FIRST_COMMIT, ORIGINAL, FIRST)

    expect(result.status).toBe(0)
    expect(result.stdout.startsWith(BODY)).toBe(true)
    expect(result.stdout.slice(BODY.length)).toContain('2026-11-19')
    expect(result.stdout.slice(BODY.length)).toContain(FIRST_COMMIT)
  })

  it('lists each of the six installers with its old and its new sha256', () => {
    const result = notes(BODY, '2026-11-19', FIRST_COMMIT, ORIGINAL, FIRST)

    expect(NAMES.filter((name) => !lineWith(result.stdout, name, ORIGINAL[name], FIRST[name]))).toEqual([])
  })

  it('keeps every earlier section when a second rebuild appends its own', () => {
    const first = notes(BODY, '2026-11-19', FIRST_COMMIT, ORIGINAL, FIRST).stdout
    const result = notes(first, '2026-11-20', SECOND_COMMIT, FIRST, SECOND)

    expect(result.status).toBe(0)
    expect(first.startsWith(BODY)).toBe(true)
    expect(result.stdout.startsWith(first)).toBe(true)
    expect(result.stdout.slice(first.length)).toContain('2026-11-20')
    expect(result.stdout.slice(first.length)).toContain(SECOND_COMMIT)
    expect(
      NAMES.filter((name) => !lineWith(result.stdout.slice(first.length), name, FIRST[name], SECOND[name])),
    ).toEqual([])
  })
})

describe('seed-audit.mjs', () => {
  const SECRET = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'
  const COMMIT = 'b657afce48407566c1bcba9d94cb9fe359855428'
  const SEED = Buffer.from('3ee6b0137153fce5144d02aacebac13284f0b980cc28efd0da8c6ceee4faaa6e', 'hex')
  const OFFSET = 37
  const LEAKS = [
    SEED.toString('latin1'),
    SEED.toString('hex'),
    SEED.toString('hex').toUpperCase(),
    SEED.toString('base64'),
    SECRET,
  ]

  function audit(paths: string[]): Run {
    return run('seed-audit.mjs', ['--version', VERSION, '--commit', COMMIT, ...paths], {
      env: { ...process.env, OPENPLC_TRUST_SEED_SECRET: SECRET },
    })
  }

  function logWith(name: string, planted: string | Buffer): string {
    const before = Buffer.from('2026-11-19T00:00:00.000Z build: ok \n'.padEnd(OFFSET, '.'), 'latin1')
    const bytes = typeof planted === 'string' ? Buffer.from(planted, 'latin1') : planted
    return write(join(root, name), concat(before, bytes, Buffer.from('\nend of log\n')))
  }

  it.each<[string, string | Buffer]>([
    ['raw bytes', SEED],
    ['lowercase hex', SEED.toString('hex')],
    ['uppercase hex', SEED.toString('hex').toUpperCase()],
    ['base64', SEED.toString('base64')],
  ])('fails on the seed of the test vector as %s, naming file and offset', (_form, planted) => {
    const file = logWith('job.log', planted)

    const result = audit([file])

    expect(result.status).toBe(1)
    expect(result.output.trim()).toMatch(new RegExp(`^match: .*job\\.log offset ${OFFSET} form \\S+$`))
  })

  it('prints no form of the seed and not the secret when it finds a match', () => {
    const files = [
      logWith('raw.bin', SEED),
      logWith('hex.log', SEED.toString('hex')),
      logWith('upper.log', SEED.toString('hex').toUpperCase()),
      logWith('base64.log', SEED.toString('base64')),
    ]

    const result = audit(files)

    expect(result.status).toBe(1)
    expect(result.output.split('\n').filter((line) => line.startsWith('match: '))).toHaveLength(4)
    expect(LEAKS.filter((leak) => result.output.includes(leak))).toEqual([])
  })

  it('searches every file under a directory it is given', () => {
    logWith(join('logs', 'build-windows-x64', '3_Build.txt'), SEED.toString('hex'))

    const result = audit([join(root, 'logs')])

    expect(result.status).toBe(1)
    expect(result.output).toContain('3_Build.txt')
  })

  it('reports no match for seeds of another version, another commit or a hex-decoded secret', () => {
    const other = (key: Buffer, message: string): string =>
      createHmac('sha256', Uint8Array.from(key)).update(message).digest('hex')
    const file = logWith(
      'other-seeds.log',
      [
        other(Buffer.from(SECRET, 'utf8'), `4.3.4+${COMMIT}`),
        other(Buffer.from(SECRET, 'utf8'), `4.3.5+0123456789abcdef0123456789abcdef01234567`),
        other(Buffer.from(SECRET, 'hex'), `4.3.5+${COMMIT}`),
      ].join('\n'),
    )

    const result = audit([file])

    expect(result.status).toBe(0)
    expect(result.output.trim()).toBe('no match')
  })
})

/** The files of a small packed editor app, by archive path. */
const APP: Record<string, string> = {
  'package.json': '{"name":"open-plc-editor","main":"dist/main/main.js"}\n',
  'dist/main/main.js': 'console.log("main process")\n'.repeat(40),
  'dist/renderer/renderer.js': 'document.body.dataset.ready = "1"\n',
  'dist/renderer/assets/style.css': 'body { margin: 0 }\n',
}

describe('lib/asar.mjs', () => {
  const lib = join(scripts, 'lib', 'asar.mjs')

  function locate(archive: string, path: string): { offset: number; size: number } {
    const value = readField(callExport(lib, 'locateFile', [archive, path]), 'value')
    return { offset: Number(readField(value, 'offset')), size: Number(readField(value, 'size')) }
  }

  it('reads the header and the header size @electron/asar reads', async () => {
    const archive = await packApp(APP)
    const raw = getRawHeader(archive)

    const value = readField(callExport(lib, 'readAsarHeader', [archive]), 'value')

    expect({ header: readField(value, 'header'), headerSize: readField(value, 'headerSize') }).toEqual({
      header: raw.header,
      headerSize: raw.headerSize,
    })
  })

  it.each(Object.keys(APP))('locates the bytes of %s inside the archive', async (path) => {
    const archive = await packApp(APP)

    const { offset, size } = locate(archive, path)

    expect(
      readFileSync(archive)
        .subarray(offset, offset + size)
        .toString('utf8'),
    ).toBe(APP[path])
  })

  it('refuses to locate a file the archive does not hold, naming it', async () => {
    const archive = await packApp(APP)

    const result = callExport(lib, 'locateFile', [archive, 'dist/main/missing.js'])

    expect(Object.keys(result)).toEqual(['refused'])
    expect(String(result.refused)).toContain('dist/main/missing.js')
  })

  it('lists the files directly in dist/main, main.js and its chunks, sorted', async () => {
    const archive = await packApp({
      ...APP,
      'dist/main/722.js': 'exports.chunk = 722\n',
      'dist/main/722.js.map': '{"version":3,"sources":[],"mappings":""}\n',
      'dist/main/nested/inner.js': 'exports.inner = 1\n',
    })

    const result = callExport(lib, 'listFiles', [archive, 'dist/main'])

    expect(result).toEqual({ value: ['dist/main/722.js', 'dist/main/722.js.map', 'dist/main/main.js'] })
  })

  it('refuses to list a directory the archive does not hold, naming it', async () => {
    const archive = await packApp(APP)

    const result = callExport(lib, 'listFiles', [archive, 'dist/missing'])

    expect(Object.keys(result)).toEqual(['refused'])
    expect(String(result.refused)).toContain('dist/missing')
  })

  it('places a same-length change of one byte of dist/main/main.js in that file only, header bytes identical', async () => {
    const archive = await packApp(APP)
    const before = readFileSync(archive)
    const headerEnd = 8 + getRawHeader(archive).headerSize
    const { offset } = locate(archive, 'dist/main/main.js')
    const changed = Buffer.from(before)
    changed[offset + 5] = changed[offset + 5] === 0x41 ? 0x42 : 0x41
    write(archive, changed)
    uncacheAll()

    const after = readFileSync(archive)
    const original = Buffer.from(APP['dist/main/main.js'])
    const main = extractFile(archive, 'dist/main/main.js')
    const differing = [...main].flatMap((byte, index) => (byte === original[index] ? [] : [index]))

    expect({
      length: after.length,
      header: sha256(after.subarray(0, headerEnd)),
      mainLength: main.length,
      differing,
      renderer: extractFile(archive, 'dist/renderer/renderer.js').toString('utf8'),
    }).toEqual({
      length: before.length,
      header: sha256(before.subarray(0, headerEnd)),
      mainLength: original.length,
      differing: [5],
      renderer: APP['dist/renderer/renderer.js'],
    })
  })

  it('extracts every file of the archive into a folder that did not exist', async () => {
    const archive = await packApp(APP)
    const dest = join(root, 'installed', 'resources', 'app')

    const result = callExport(lib, 'extractAsar', [archive, dest])

    expect(Object.keys(result)).toEqual(['value'])
    expect(Object.fromEntries(listTree(dest).map((path) => [path, readFileSync(join(dest, path), 'utf8')]))).toEqual(
      APP,
    )
  })

  describe('with an entry in app.asar.unpacked', () => {
    const NATIVE = 'native/addon.node'
    const WITH_NATIVE = { ...APP, [NATIVE]: 'native module bytes\n' }

    it('refuses to locate the unpacked entry, naming it as unpacked', async () => {
      const archive = await packApp(WITH_NATIVE, 'installed', '*.node')

      const result = callExport(lib, 'locateFile', [archive, NATIVE])

      expect(Object.keys(result)).toEqual(['refused'])
      expect(String(result.refused)).toContain(NATIVE)
      expect(String(result.refused)).toContain('unpacked')
    })

    it('extracts the packed files and copies the unpacked entry from app.asar.unpacked', async () => {
      const archive = await packApp(WITH_NATIVE, 'installed', '*.node')
      const dest = join(root, 'installed', 'resources', 'app')

      callExport(lib, 'extractAsar', [archive, dest])

      expect(Object.fromEntries(listTree(dest).map((path) => [path, readFileSync(join(dest, path), 'utf8')]))).toEqual(
        WITH_NATIVE,
      )
    })
  })
})

describe('lib/vpp-fixture.mjs', () => {
  const lib = join(scripts, 'lib', 'vpp-fixture.mjs')

  /** What `writeEqsp32Vpp` reports about the package it wrote. */
  type Written = { keyId: unknown; packageId: unknown; boardName: unknown; publicKeyPem: string }

  function writeVpp(path: string): Written {
    const value = readField(callExport(lib, 'writeEqsp32Vpp', [path]), 'value')
    return {
      keyId: readField(value, 'keyId'),
      packageId: readField(value, 'packageId'),
      boardName: readField(value, 'boardName'),
      publicKeyPem: String(readField(value, 'publicKeyPem')),
    }
  }

  async function extracted(vpp: string, name = 'extracted'): Promise<string> {
    const dir = join(root, name)
    await extract(vpp, { dir })
    return dir
  }

  function manifestOf(dir: string): unknown {
    return JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))
  }

  /** Every file under @p dir with its content, by POSIX relative path. */
  function contents(dir: string): Record<string, string> {
    return Object.fromEntries(listTree(dir).map((path) => [path, sha256(readFileSync(join(dir, path)))]))
  }

  function place(vppPath: string, userDataDir: string): { packageId: unknown; packageDir: string } {
    const value = readField(callExport(lib, 'placePackageByHand', [{ vppPath, userDataDir }]), 'value')
    return { packageId: readField(value, 'packageId'), packageDir: String(readField(value, 'packageDir')) }
  }

  function registryOf(userDataDir: string): unknown {
    return JSON.parse(readFileSync(join(userDataDir, 'packages', 'registry.json'), 'utf8'))
  }

  /** The CRC-32 of @p bytes, as ZIP records it. */
  function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff
    for (const byte of bytes) {
      crc ^= byte
      for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
    return (crc ^ 0xffffffff) >>> 0
  }

  /** The local file entries of a ZIP, in order: name, compression method and whether the recorded CRC-32 matches. */
  function zipEntries(zip: Buffer): { name: string; method: number; crcMatches: boolean }[] {
    const entries: { name: string; method: number; crcMatches: boolean }[] = []
    let at = 0
    while (at + 30 <= zip.length && zip.readUInt32LE(at) === 0x04034b50) {
      const method = zip.readUInt16LE(at + 8)
      const crc = zip.readUInt32LE(at + 14)
      const size = zip.readUInt32LE(at + 18)
      const nameLength = zip.readUInt16LE(at + 26)
      const extraLength = zip.readUInt16LE(at + 28)
      const name = zip.subarray(at + 30, at + 30 + nameLength).toString('utf8')
      const start = at + 30 + nameLength + extraLength
      entries.push({ name, method, crcMatches: crc32(Uint8Array.from(zip.subarray(start, start + size))) === crc })
      at = start + size
    }
    return entries
  }

  it('reports the package com.erqos.eqsp32 signed under the key id eqsp32-dev', () => {
    const written = writeVpp(join(root, 'eqsp32.vpp'))

    expect({ keyId: written.keyId, packageId: written.packageId }).toEqual({
      keyId: 'eqsp32-dev',
      packageId: 'com.erqos.eqsp32',
    })
  })

  it('writes a .vpp that extracts with extract-zip and verifies under the key it reports', async () => {
    const vpp = join(root, 'eqsp32.vpp')
    const written = writeVpp(vpp)

    expect(verifyPackageSignature(await extracted(vpp), { 'eqsp32-dev': written.publicKeyPem })).toEqual({
      valid: true,
    })
  })

  it('is refused under another key with the same key id', async () => {
    const vpp = join(root, 'eqsp32.vpp')
    writeVpp(vpp)
    const other = String(generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }))

    expect(verifyPackageSignature(await extracted(vpp), { 'eqsp32-dev': other }).valid).toBe(false)
  })

  it('is refused when only another key id is trusted, even one holding its own key', async () => {
    const vpp = join(root, 'eqsp32.vpp')
    const written = writeVpp(vpp)

    expect(verifyPackageSignature(await extracted(vpp), { 'openplc-2026': written.publicKeyPem }).valid).toBe(false)
  })

  it('declares in its manifest the board name it reports', async () => {
    const vpp = join(root, 'eqsp32.vpp')
    const written = writeVpp(vpp)
    const manifest = manifestOf(await extracted(vpp))
    const devices = readField(manifest, 'devices')
    const names = Array.isArray(devices) ? devices.map((device) => readField(device, 'name')) : []

    expect(typeof written.boardName === 'string' && written.boardName !== '').toBe(true)
    expect(names).toContain(written.boardName)
  })

  it('writes a manifest the editor accepts, with 4.3.0 as its minimum editor version', async () => {
    const vpp = join(root, 'eqsp32.vpp')
    writeVpp(vpp)
    const manifest = manifestOf(await extracted(vpp))

    expect(PackageManifestSchema.safeParse(manifest).success).toBe(true)
    expect(readField(readField(manifest, 'package'), 'minEditorVersion')).toBe('4.3.0')
  })

  it('stores every entry uncompressed, with its CRC-32', () => {
    const vpp = join(root, 'eqsp32.vpp')
    writeVpp(vpp)

    const entries = zipEntries(readFileSync(vpp))

    expect(entries.map((entry) => entry.name)).toEqual(expect.arrayContaining(['manifest.json', 'signature.json']))
    expect(entries.filter((entry) => entry.method !== 0 || !entry.crcMatches)).toEqual([])
  })

  it('signs with a fresh key on every run', () => {
    const first = writeVpp(join(root, 'first.vpp'))
    const second = writeVpp(join(root, 'second.vpp'))

    expect(first.publicKeyPem).toContain('-----BEGIN PUBLIC KEY-----')
    expect(second.publicKeyPem).not.toBe(first.publicKeyPem)
  })

  describe('placePackageByHand', () => {
    it('places the package under packages/<id> and creates the registry with its entry', async () => {
      const vpp = join(root, 'eqsp32.vpp')
      writeVpp(vpp)
      const manifest = manifestOf(await extracted(vpp))
      const devices = readField(manifest, 'devices')
      const userData = join(root, 'user-data')
      const packageDir = join(userData, 'packages', 'com.erqos.eqsp32')

      const placed = place(vpp, userData)
      const registry = registryOf(userData)
      const entry = readField(readField(registry, 'packages'), 'com.erqos.eqsp32')
      const installedAt = readField(entry, 'installedAt')

      expect(placed).toEqual({ packageId: 'com.erqos.eqsp32', packageDir })
      expect(Object.keys(readField(registry, 'packages') ?? {})).toEqual(['com.erqos.eqsp32'])
      expect(readField(registry, 'formatVersion')).toBe('1.0')
      expect({
        version: readField(entry, 'version'),
        path: readField(entry, 'path'),
        devices: readField(entry, 'devices'),
        installedAt: typeof installedAt === 'string' && !Number.isNaN(Date.parse(installedAt)),
      }).toEqual({
        version: readField(readField(manifest, 'package'), 'version'),
        path: packageDir,
        devices: Array.isArray(devices) ? devices.map((device) => readField(device, 'id')) : [],
        installedAt: true,
      })
    })

    it('places exactly the files of the .vpp, still verifying under the reported key', async () => {
      const vpp = join(root, 'eqsp32.vpp')
      const written = writeVpp(vpp)
      const expected = contents(await extracted(vpp))

      const { packageDir } = place(vpp, join(root, 'user-data'))

      expect(contents(packageDir)).toEqual(expected)
      expect(verifyPackageSignature(packageDir, { 'eqsp32-dev': written.publicKeyPem })).toEqual({ valid: true })
    })

    it('keeps the entries a registry already holds', () => {
      const vpp = join(root, 'eqsp32.vpp')
      writeVpp(vpp)
      const userData = join(root, 'user-data')
      const existing = {
        version: '2.1.0',
        installedAt: '2026-06-01T00:00:00.000Z',
        path: join(userData, 'packages', 'com.openplc.fx3u-compatible'),
        devices: ['fx3u-14m'],
      }
      writeJson(join(userData, 'packages', 'registry.json'), {
        formatVersion: '1.0',
        packages: { 'com.openplc.fx3u-compatible': existing },
      })

      place(vpp, userData)
      const packages = readField(registryOf(userData), 'packages')

      expect(Object.keys(packages ?? {}).sort()).toEqual(['com.erqos.eqsp32', 'com.openplc.fx3u-compatible'])
      expect(readField(packages, 'com.openplc.fx3u-compatible')).toEqual(existing)
    })

    it('extracts a .vpp whose entries are deflated', async () => {
      const vpp = join(root, 'eqsp32.vpp')
      const written = writeVpp(vpp)
      const source = await extracted(vpp)
      const zip = new JSZip()
      for (const path of listTree(source)) zip.file(path, Uint8Array.from(readFileSync(join(source, path))))
      const deflated = write(
        join(root, 'deflated.vpp'),
        Buffer.from(await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })),
      )

      const { packageDir } = place(deflated, join(root, 'user-data'))

      expect(zipEntries(readFileSync(deflated)).some((entry) => entry.method === 8)).toBe(true)
      expect(contents(packageDir)).toEqual(contents(source))
      expect(verifyPackageSignature(packageDir, { 'eqsp32-dev': written.publicKeyPem })).toEqual({ valid: true })
    })
  })
})

describe('fixtures/patch-trust-reproducer.mjs', () => {
  const reproducer = join(scripts, 'fixtures', 'patch-trust-reproducer.mjs')
  const MESSAGE = 'Could not locate the trusted-keys object in dist/main'
  const BEGIN = '-----BEGIN PUBLIC KEY-----'
  const KEY = testKey('openplc-2026', 0x33)
  const TRUSTED_OBJECT = JSON.stringify({ [KEY.id]: KEY.pem })
  const PATCH_TIMEOUT = 60_000

  function patch(archive: string): Run {
    return node([reproducer, archive], { cwd: repo, timeout: PATCH_TIMEOUT })
  }

  function patchable(): Record<string, string> {
    return { ...APP, 'dist/main/main.js': `const keys = ${TRUSTED_OBJECT}\nmodule.exports = keys\n` }
  }

  it(
    'patches an app.asar whose dist/main holds the trusted-keys object: exit 0 and one more key in that object',
    async () => {
      const archive = await packApp(patchable())
      const before = sha256(readFileSync(archive))

      const result = patch(archive)
      uncacheAll()
      const main = extractFile(archive, 'dist/main/main.js').toString('utf8')

      expect(result.status).toBe(0)
      expect(sha256(readFileSync(archive))).not.toBe(before)
      expect(main).toContain(TRUSTED_OBJECT.slice(0, -1))
      expect(main.split(BEGIN).length - 1).toBe(2)
    },
    PATCH_TIMEOUT,
  )

  it(
    'patches the object when it sits in a dynamic-import chunk beside main.js',
    async () => {
      const archive = await packApp({ ...APP, 'dist/main/722.js': `exports.keys = ${TRUSTED_OBJECT}\n` })
      const before = sha256(readFileSync(archive))

      const result = patch(archive)
      uncacheAll()
      const chunk = extractFile(archive, 'dist/main/722.js').toString('utf8')

      expect(result.status).toBe(0)
      expect(sha256(readFileSync(archive))).not.toBe(before)
      expect(chunk.split(BEGIN).length - 1).toBe(2)
    },
    PATCH_TIMEOUT,
  )

  it(
    'backs the original archive up to app.asar.bak',
    async () => {
      const archive = await packApp(patchable())
      const before = sha256(readFileSync(archive))

      patch(archive)

      expect(sha256(readFileSync(`${archive}.bak`))).toBe(before)
    },
    PATCH_TIMEOUT,
  )

  it.each<[string, Record<string, string>]>([
    ['no trusted-keys object', { 'dist/main/main.js': 'module.exports = {}\n' }],
    [
      'the object only outside dist/main',
      { 'dist/main/main.js': 'module.exports = {}\n', 'dist/renderer/keys.js': `window.keys = ${TRUSTED_OBJECT}\n` },
    ],
    [
      'the object in two files of dist/main',
      { 'dist/main/main.js': `const a = ${TRUSTED_OBJECT}\n`, 'dist/main/cli.js': `const b = ${TRUSTED_OBJECT}\n` },
    ],
  ])(
    'exits 1 with the message and leaves app.asar byte-identical for an archive with %s',
    async (_case, files) => {
      const archive = await packApp({ ...APP, ...files })
      const before = sha256(readFileSync(archive))

      const result = patch(archive)

      expect(result.status).toBe(1)
      expect(result.output).toContain(MESSAGE)
      expect(sha256(readFileSync(archive))).toBe(before)
    },
    PATCH_TIMEOUT,
  )
})

describe('packaged-checks.mjs', () => {
  const script = join(scripts, 'packaged-checks.mjs')
  const OPTIONS = ['--platform', '--installer', '--version', '--positive-control', '--trusted-keys', '--report']
  const CHECK_IDS = [
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
  ]

  /** Every option of a run that must stop before installing: a non-executable installer and a wrong fx3u file. */
  function inputs(overrides: Record<string, string> = {}): Record<string, string> {
    return {
      '--platform': 'linux',
      '--installer': write(join(root, 'OpenPLC.Editor-4.3.5.AppImage'), 'not an installer\n'),
      '--version': '4.3.5',
      '--positive-control': write(join(root, 'com.openplc.fx3u-compatible-2.1.0.vpp'), 'not the fx3u package\n'),
      '--trusted-keys': write(join(root, 'trusted-keys.ts'), 'export const TRUSTED_PACKAGE_KEYS = {}\n'),
      '--report': join(root, 'report.json'),
      ...overrides,
    }
  }

  function argv(options: Record<string, string>): string[] {
    return Object.entries(options).flat()
  }

  describe('command line', () => {
    function refusal(options: Record<string, string>): { status: number; output: string; report: boolean } {
      const result = run('packaged-checks.mjs', argv(options), { timeout: 60_000 })
      return { status: result.status, output: result.output, report: existsSync(join(root, 'report.json')) }
    }

    it.each(OPTIONS)('exits 2 without %s, naming it, before installing and without a report', (option) => {
      const options = inputs()
      delete options[option]

      const result = refusal(options)

      expect({ status: result.status, report: result.report }).toEqual({ status: 2, report: false })
      expect(result.output).toContain(option)
    })

    it('exits 2 for a platform other than mac, win and linux, naming it, without a report', () => {
      const result = refusal(inputs({ '--platform': 'solaris' }))

      expect({ status: result.status, report: result.report }).toEqual({ status: 2, report: false })
      expect(result.output).toContain('solaris')
    })

    it('exits 2 for a positive control whose sha256 is not the pinned fx3u digest, naming the file', () => {
      const options = inputs()

      const result = refusal(options)

      expect({ status: result.status, report: result.report }).toEqual({ status: 2, report: false })
      expect(result.output).toContain(options['--positive-control'])
    })

    it('exports the 16 check ids in order, and importing it runs no check', () => {
      expect(readExport(script, 'CHECK_IDS')).toEqual({ value: CHECK_IDS })
    })
  })

  describe('findTrustChunk', () => {
    const TRUST_SOURCE = './release/package-trust/package-trust-anchor.ts'

    function sourceMap(...sources: string[]): string {
      return JSON.stringify({ version: 3, sources, mappings: '' })
    }

    /** A main-process bundle: main.js with its own map, plus @p chunks by file name under dist/main. */
    function bundle(chunks: Record<string, string>, name = 'installed'): Promise<string> {
      const files: Record<string, string> = {
        ...APP,
        'dist/main/main.js.map': sourceMap('./src/main/entry.ts'),
      }
      for (const [file, content] of Object.entries(chunks)) files[`dist/main/${file}`] = content
      return packApp(files, name)
    }

    function find(archive: string): { path: unknown; reason: unknown; refused: unknown } {
      const result = callExport(script, 'findTrustChunk', [archive])
      return {
        path: readField(result.value, 'path'),
        reason: readField(result.value, 'reason'),
        refused: result.refused,
      }
    }

    it('picks the chunk whose source map lists the trust module', async () => {
      const archive = await bundle({
        '722.js': 'exports.anchor = function () {}\n',
        '722.js.map': sourceMap('./src/backend/editor/package-trust/index.ts', TRUST_SOURCE),
        '41.js': 'exports.gui = 1\n',
        '41.js.map': sourceMap('./src/main/gui.ts'),
      })

      const found = find(archive)

      expect(found.path).toBe('dist/main/722.js')
      expect(typeof found.reason === 'string' && found.reason.trim() !== '').toBe(true)
    })

    it('without that source map, picks the file holding "openplc-2026"', async () => {
      const archive = await bundle({
        '41.js': 'exports.keys = {"openplc-2026":"-----BEGIN PUBLIC KEY-----\\n"}\n',
        '41.js.map': sourceMap('./src/backend/shared/utils/vpp/trusted-keys.ts'),
        '722.js': 'exports.cli = 1\n',
      })

      const found = find(archive)

      expect(found.path).toBe('dist/main/41.js')
      expect(typeof found.reason === 'string' && found.reason.trim() !== '').toBe(true)
    })

    it('prefers the source-map rule to the literal rule, and reports a different reason for each', async () => {
      const both = find(
        await bundle({
          '722.js': 'exports.anchor = function () {}\n',
          '722.js.map': sourceMap(TRUST_SOURCE),
          '41.js': 'exports.id = "openplc-2026"\n',
        }),
      )
      const literalOnly = find(await bundle({ '41.js': 'exports.id = "openplc-2026"\n' }, 'original'))

      expect({ both: both.path, literalOnly: literalOnly.path }).toEqual({
        both: 'dist/main/722.js',
        literalOnly: 'dist/main/41.js',
      })
      expect(both.reason).not.toEqual(literalOnly.reason)
    })

    it('throws naming dist/main when no file matches either rule', async () => {
      const archive = await bundle({ '722.js': 'exports.cli = 1\n', '722.js.map': sourceMap('./src/main/cli.ts') })

      const found = find(archive)

      expect(found.path).toBeUndefined()
      expect(String(found.refused)).toContain('dist/main')
    })
  })

  describe('observeStart', () => {
    const posix = process.platform === 'win32' ? it.skip : it

    /** Writes a fake editor: a Node script that ends on its own after 20 s if nothing kills it. */
    function fake(name: string, body: string): string {
      return write(join(root, 'fakes', `${name}.js`), `setTimeout(() => process.exit(3), 20000).unref()\n${body}\n`)
    }

    function observe(path: string, windowMs: number, args: string[] = []): Record<string, unknown> {
      const value = readField(
        callExport(script, 'observeStart', [{ command: process.execPath, args: [path, ...args], cwd: root, windowMs }]),
        'value',
      )
      return {
        verdict: readField(value, 'verdict'),
        exitCode: readField(value, 'exitCode'),
        signal: readField(value, 'signal'),
        ms: readField(value, 'ms'),
        stderr: readField(value, 'stderr'),
      }
    }

    function isAlive(pid: number): boolean {
      try {
        process.kill(pid, 0)
        return true
      } catch {
        return false
      }
    }

    it('counts a process still alive at the end of the window as started, and kills it', () => {
      const pidFile = join(root, 'pid.txt')
      const alive = fake(
        'alive',
        "require('node:fs').writeFileSync(process.argv[2], String(process.pid))\nsetInterval(() => {}, 1000)",
      )

      const observed = observe(alive, 1500, [pidFile])

      expect(observed.verdict).toBe('starts')
      expect(isAlive(Number(readFileSync(pidFile, 'utf8')))).toBe(false)
    })

    it('counts a non-zero exit within the window as not started, with the exit code, the time and stderr', () => {
      const failing = fake(
        'exit-1',
        "process.stderr.write('Integrity check failed for asar archive\\n')\nprocess.exitCode = 1",
      )

      const observed = observe(failing, 10_000)

      expect({ verdict: observed.verdict, exitCode: observed.exitCode, signal: observed.signal }).toEqual({
        verdict: 'does-not-start',
        exitCode: 1,
        signal: null,
      })
      expect(typeof observed.ms === 'number' && observed.ms < 10_000).toBe(true)
      expect(String(observed.stderr)).toContain('Integrity check failed for asar archive')
    })

    posix('counts a termination by a signal within the window as not started, naming the signal', () => {
      const trapped = fake(
        'sigtrap',
        "process.stderr.write('Integrity check failed for asar archive\\n', () => process.kill(process.pid, 'SIGTRAP'))",
      )

      const observed = observe(trapped, 10_000)

      expect({ verdict: observed.verdict, exitCode: observed.exitCode, signal: observed.signal }).toEqual({
        verdict: 'does-not-start',
        exitCode: null,
        signal: 'SIGTRAP',
      })
      expect(String(observed.stderr)).toContain('Integrity check failed for asar archive')
    })

    it('fails the check when the process exits 0 within the window', () => {
      const quiet = fake('exit-0', 'process.exitCode = 0')

      const observed = observe(quiet, 10_000)

      expect({ verdict: observed.verdict, exitCode: observed.exitCode }).toEqual({
        verdict: 'exited-zero',
        exitCode: 0,
      })
    })
  })

  describe('planChecks', () => {
    /** One planned check: its id, its mode and its reason (empty when it has none). */
    type Planned = { id: string; mode: unknown; reason: string; hasReason: boolean }

    const PLATFORMS = ['mac', 'win', 'linux']
    const RUNS: [string, boolean][] = PLATFORMS.flatMap((platform): [string, boolean][] => [
      [platform, false],
      [platform, true],
    ])

    /** The checks each platform skips in both runs, for a version that has `openplc-cli packages`. */
    const PLATFORM_SKIPS: Record<string, string[]> = {
      mac: ['AC5 packages install'],
      win: ['ABUSE-07 SIGUSR1', 'AC5 packages install'],
      linux: ['ABUSE-06 row 1', 'ABUSE-06 row 2'],
    }
    const NEGATIVE_NORMAL = ['start', 'ABUSE-07 NODE_OPTIONS']
    const NEGATIVE_SKIPPED = ['ABUSE-13 (a)', 'ABUSE-03 (b)', 'ABUSE-03 (e)', 'AC5 compile', 'AC5 packages install']

    function plan(platform: string, version: string, negativeControl: boolean): Planned[] {
      const value = readField(callExport(script, 'planChecks', [{ platform, version, negativeControl }]), 'value')
      return (Array.isArray(value) ? value : []).map((planned) => {
        const reason = readField(planned, 'reason')
        return {
          id: String(readField(planned, 'id')),
          mode: readField(planned, 'mode'),
          reason: typeof reason === 'string' ? reason : '',
          hasReason: typeof reason === 'string' && reason.trim() !== '',
        }
      })
    }

    function modes(platform: string, version: string, negativeControl: boolean): Record<string, unknown> {
      return Object.fromEntries(plan(platform, version, negativeControl).map((planned) => [planned.id, planned.mode]))
    }

    function expectedModes(platform: string, negativeControl: boolean): Record<string, string> {
      return Object.fromEntries(
        CHECK_IDS.map((id) => {
          if (PLATFORM_SKIPS[platform].includes(id)) return [id, 'skipped']
          if (!negativeControl || NEGATIVE_NORMAL.includes(id)) return [id, 'normal']
          return [id, NEGATIVE_SKIPPED.includes(id) ? 'skipped' : 'inverted']
        }),
      )
    }

    function reasonOf(platform: string, version: string, negativeControl: boolean, id: string): string {
      return plan(platform, version, negativeControl).find((planned) => planned.id === id)?.reason ?? ''
    }

    it.each(RUNS)('lists the 16 checks in CHECK_IDS order on %s (negativeControl %s)', (platform, negativeControl) => {
      expect(plan(platform, '4.3.5', negativeControl).map((planned) => planned.id)).toEqual(CHECK_IDS)
    })

    it.each(RUNS)('gives each check on %s (negativeControl %s) its mode of the table', (platform, negativeControl) => {
      expect(modes(platform, '4.3.5', negativeControl)).toEqual(expectedModes(platform, negativeControl))
    })

    it.each(RUNS)(
      'gives a reason exactly to the skipped checks on %s (negativeControl %s), for 4.3.0 and 4.3.5',
      (platform, negativeControl) => {
        const mismatched = ['4.3.0', '4.3.5'].flatMap((version) =>
          plan(platform, version, negativeControl)
            .filter((planned) => (planned.mode === 'skipped') !== planned.hasReason)
            .map((planned) => `${version} ${planned.id}`),
        )

        expect(mismatched).toEqual([])
      },
    )

    it.each(['4.3.0', '4.3.1'])('skips both packages install rows for %s, naming 4.3.2 in the reason', (version) => {
      const rows = ['ABUSE-03 (b)', 'AC5 packages install']
      const planned = plan('linux', version, false).filter((entry) => rows.includes(entry.id))

      expect(planned.map((entry) => entry.mode)).toEqual(['skipped', 'skipped'])
      expect(planned.filter((entry) => !entry.reason.includes('4.3.2'))).toEqual([])
      expect(planned.filter((entry) => !entry.reason.includes('openplc-cli packages'))).toEqual([])
    })

    it.each(['4.3.2', '4.3.5', '4.10.0'])('runs both packages install rows on Linux for %s', (version) => {
      const found = modes('linux', version, false)

      expect({ eqsp32: found['ABUSE-03 (b)'], fx3u: found['AC5 packages install'] }).toEqual({
        eqsp32: 'normal',
        fx3u: 'normal',
      })
    })

    it.each<[string, string, string]>([
      ['linux', 'ABUSE-06 row 1', 'ABUSE-06 needs ASAR integrity: macOS and Windows only'],
      ['win', 'ABUSE-07 SIGUSR1', 'no SIGUSR1 on Windows'],
      ['mac', 'AC5 packages install', 'the arduino core download runs on Linux x64 only'],
    ])('names the platform when it skips a check on %s: %s', (platform, id, reason) => {
      expect(reasonOf(platform, '4.3.5', false, id)).toContain(reason)
    })

    it.each<[string, string]>([
      ['ABUSE-13 (a)', 'an unpatched original loads app.asar before an app folder too'],
      ['ABUSE-03 (b)', "an unpatched original refuses another key's package too"],
      ['ABUSE-03 (e)', "an unpatched original refuses another key's package too"],
      ['AC5 compile', 'positive controls run on the hardened installer'],
      ['AC5 packages install', 'positive controls run on the hardened installer'],
    ])('gives the negative-control skip of %s its reason', (id, reason) => {
      expect(reasonOf('linux', '4.3.5', true, id)).toContain(reason)
    })
  })

  describe('judge', () => {
    it.each([
      ['normal', false, 'pass'],
      ['normal', true, 'fail'],
      ['inverted', true, 'pass'],
      ['inverted', false, 'fail'],
    ])('judges a %s check whose attack succeeded=%s as %s', (mode, attackSucceeded, verdict) => {
      expect(callExport(script, 'judge', [{ mode, attackSucceeded }])).toEqual({ value: verdict })
    })
  })
})
