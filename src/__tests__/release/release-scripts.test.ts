/**
 * The release check scripts of `scripts/release/`, each run as a CI step runs it: one Node process per call, over
 * files written to a temporary directory. Fuse wires, keys and digests are synthetic, so no Electron binary is needed.
 * @jest-environment node
 */
import { execFileSync } from 'node:child_process'
import { createHash, createHmac, createPrivateKey, createPublicKey } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals'

const repo = join(__dirname, '..', '..', '..')
const scripts = join(repo, 'scripts', 'release')

/** Exit status and output of one script run; `output` is stdout followed by stderr. Both are read as latin1. */
type Run = { status: number; stdout: string; output: string }

let root = ''

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

function node(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Run {
  try {
    const stdout = execFileSync(process.execPath, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? process.env,
      encoding: 'latin1',
      stdio: 'pipe',
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

function run(script: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Run {
  return node([join(scripts, script), ...args], options)
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
    const code = [
      `import * as lib from ${JSON.stringify(pathToFileURL(lib).href)}`,
      'try {',
      `  process.stdout.write('VALUE ' + JSON.stringify(lib[${JSON.stringify(name)}](${JSON.stringify(arg)})))`,
      '} catch (error) {',
      "  process.stdout.write('REFUSED ' + (error instanceof Error ? error.message : String(error)))",
      '}',
    ].join('\n')
    const result = node(['--input-type=module', '-e', code])
    if (result.status === 0 && result.stdout.startsWith('VALUE ')) {
      const value: unknown = JSON.parse(result.stdout.slice('VALUE '.length))
      return { value }
    }
    if (result.status === 0 && result.stdout.startsWith('REFUSED ')) return { refused: result.stdout.slice(8) }
    return { failure: result.output }
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

  type TestKey = { id: string; pem: string; body: string; raw: Buffer }

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
