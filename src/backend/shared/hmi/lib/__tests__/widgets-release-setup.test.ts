import {
  HMI_CORE_API_VERSION,
  WIDGETS_RELEASE_MANIFEST,
} from '../../../../../middleware/shared/utils/hmi/widget-libraries'
import {
  setupWidgetsRelease,
  sha256Hex,
  type WidgetsReleasePin,
  widgetsReleasePin,
  WidgetsSetupError,
  type WidgetsSetupMechanisms,
} from '../widgets-release-setup'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const RELEASE_BASE = 'https://github.com/Autonomy-Logic/openplc-hmi-widgets/releases/download/v1.0.0/'

interface ReleaseFiles {
  files: Map<string, Uint8Array>
  manifestSha256: string
}

/** A release whose manifest describes its archives, built the way the release build writes it. */
async function makeRelease(
  options: { hmiCoreApi?: number; tamper?: string; version?: string } = {},
): Promise<ReleaseFiles> {
  const archives = [
    {
      name: 'hmi-alarms',
      kind: 'plc' as const,
      text: JSON.stringify({
        manifest: { name: 'hmi-alarms', version: '1.0.0' },
        openplc: { formatVersion: 1, kind: 'plc', license: 'GPL-3.0-only' },
      }),
    },
    {
      name: 'standard-widgets',
      kind: 'hmi' as const,
      text: JSON.stringify({
        manifest: { name: 'standard-widgets', version: '1.0.0' },
        openplc: {
          formatVersion: 1,
          kind: 'hmi',
          license: 'GPL-3.0-only',
          hmiCoreApi: options.hmiCoreApi ?? HMI_CORE_API_VERSION,
          catalog: { widgets: [], colors: [] },
        },
      }),
    },
  ]
  const files = new Map<string, Uint8Array>()
  const entries = []
  for (const a of archives) {
    const bytes = encoder.encode(a.text)
    files.set(`${a.name}.stlib`, bytes)
    const common = {
      name: a.name,
      displayName: a.name,
      version: '1.0.0',
      file: `${a.name}.stlib`,
      sha256: await sha256Hex(bytes),
      size: bytes.length,
      strucppVersion: '0.8.1-rc1',
      headers: [],
      license: 'GPL-3.0-only',
    }
    entries.push(
      a.kind === 'hmi'
        ? {
            ...common,
            kind: a.kind,
            hmiCoreApi: options.hmiCoreApi ?? HMI_CORE_API_VERSION,
            catalog: { widgets: [], colors: [] },
          }
        : { ...common, kind: a.kind },
    )
  }
  const manifest = encoder.encode(
    JSON.stringify({
      formatVersion: 1,
      name: 'openplc-hmi-widgets',
      version: options.version ?? '1.0.0',
      strucppVersion: '0.8.1-rc1',
      archives: entries,
    }),
  )
  files.set(WIDGETS_RELEASE_MANIFEST, manifest)
  if (options.tamper) files.set(options.tamper, encoder.encode('{"manifest":{"name":"tampered"}}'))
  return { files, manifestSha256: await sha256Hex(manifest) }
}

/** In-memory mechanisms: a release server, local build directories and the installed directory. */
function memory(published: Map<string, Uint8Array> | null, builds: Record<string, Map<string, Uint8Array>> = {}) {
  const installed = new Map<string, Uint8Array>()
  const fetched: string[] = []
  const logs: string[] = []
  let writes = 0
  const mechanisms: WidgetsSetupMechanisms = {
    fetchAsset: (url) => {
      fetched.push(url)
      const file = url.startsWith(RELEASE_BASE) ? url.slice(RELEASE_BASE.length) : ''
      return Promise.resolve(published?.get(file) ?? null)
    },
    readOverride: (dir, file) => Promise.resolve(builds[dir]?.get(file) ?? null),
    readInstalled: (file) => Promise.resolve(installed.get(file) ?? null),
    writeInstalled: (files) => {
      writes++
      installed.clear()
      for (const [name, bytes] of files) installed.set(name, bytes)
      return Promise.resolve()
    },
    log: (message) => logs.push(message),
  }
  return { mechanisms, installed, fetched, logs, writes: () => writes }
}

const pinOf = (sha: string): WidgetsReleasePin => ({
  version: 'v1.0.0',
  repository: 'Autonomy-Logic/openplc-hmi-widgets',
  manifestSha256: sha,
})

describe('HMI widgets release setup', () => {
  it('downloads the pinned release, checking the manifest against the pin and each archive against the manifest', async () => {
    const release = await makeRelease()
    const m = memory(release.files)
    const result = await setupWidgetsRelease(pinOf(release.manifestSha256), {}, m.mechanisms)
    expect(result.source).toBe('release')
    expect(m.fetched).toEqual([
      `${RELEASE_BASE}${WIDGETS_RELEASE_MANIFEST}`,
      `${RELEASE_BASE}hmi-alarms.stlib`,
      `${RELEASE_BASE}standard-widgets.stlib`,
    ])
    expect([...m.installed.keys()].sort()).toEqual([
      'hmi-alarms.stlib',
      WIDGETS_RELEASE_MANIFEST,
      'standard-widgets.stlib',
    ])
  })

  it('skips the download when the pinned release is installed and intact, and repairs it when it is not', async () => {
    const release = await makeRelease()
    const m = memory(release.files)
    await setupWidgetsRelease(pinOf(release.manifestSha256), {}, m.mechanisms)
    m.fetched.length = 0
    expect((await setupWidgetsRelease(pinOf(release.manifestSha256), {}, m.mechanisms)).source).toBe('installed')
    expect(m.fetched).toEqual([])
    m.installed.set('standard-widgets.stlib', encoder.encode('{}'))
    expect((await setupWidgetsRelease(pinOf(release.manifestSha256), {}, m.mechanisms)).source).toBe('release')
    expect(decoder.decode(m.installed.get('standard-widgets.stlib'))).toContain('"kind":"hmi"')
  })

  it('refuses a release whose manifest does not match the pin, and installs nothing', async () => {
    const release = await makeRelease()
    const m = memory(release.files)
    const pinned = 'f'.repeat(64)
    await expect(setupWidgetsRelease(pinOf(pinned), {}, m.mechanisms)).rejects.toThrow(
      `has SHA-256 ${release.manifestSha256}, but binary-versions.json pins ${pinned}`,
    )
    expect(m.writes()).toBe(0)
  })

  it('refuses a release whose archive does not match the manifest, and installs nothing', async () => {
    const release = await makeRelease({ tamper: 'standard-widgets.stlib' })
    const m = memory(release.files)
    await expect(setupWidgetsRelease(pinOf(release.manifestSha256), {}, m.mechanisms)).rejects.toThrow(
      /standard-widgets\.stlib has SHA-256 [0-9a-f]{64}, the manifest says/,
    )
    expect(m.writes()).toBe(0)
  })

  it('refuses a release built for another HMI core API', async () => {
    const release = await makeRelease({ hmiCoreApi: HMI_CORE_API_VERSION + 1 })
    const m = memory(release.files)
    await expect(setupWidgetsRelease(pinOf(release.manifestSha256), {}, m.mechanisms)).rejects.toThrow(
      `is built for HMI core API ${HMI_CORE_API_VERSION + 1}, but this editor provides HMI core API ${HMI_CORE_API_VERSION}`,
    )
    expect(m.writes()).toBe(0)
  })

  it('fails with what to do when the release is not published and no local build is named', async () => {
    const m = memory(null)
    const error = await setupWidgetsRelease(pinOf('a'.repeat(64)), {}, m.mechanisms).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WidgetsSetupError)
    expect(error instanceof Error && error.message).toBe(
      'The HMI widgets release v1.0.0 is not published on Autonomy-Logic/openplc-hmi-widgets ' +
        `(${RELEASE_BASE}${WIDGETS_RELEASE_MANIFEST} was not found). Set OPENPLC_HMI_WIDGETS_DIR to a local ` +
        'openplc-hmi-widgets build directory (its dist/) to set up without it.',
    )
  })

  it('installs a local build instead of the release, checking it the same way and saying it differs from the pin', async () => {
    const build = await makeRelease({ version: '1.1.0' })
    const m = memory(null, { '/build/dist': build.files })
    const result = await setupWidgetsRelease(pinOf('a'.repeat(64)), { overrideDir: '/build/dist' }, m.mechanisms)
    expect(result).toMatchObject({ source: 'override', release: { version: '1.1.0' } })
    expect(m.fetched).toEqual([])
    expect(m.logs).toEqual([expect.stringContaining('differs from the pinned v1.0.0')])
    expect(
      (await setupWidgetsRelease(pinOf('a'.repeat(64)), { overrideDir: '/build/dist' }, m.mechanisms)).source,
    ).toBe('installed')
    const broken = await makeRelease({ tamper: 'hmi-alarms.stlib' })
    const n = memory(null, { '/broken': broken.files })
    await expect(setupWidgetsRelease(pinOf('a'.repeat(64)), { overrideDir: '/broken' }, n.mechanisms)).rejects.toThrow(
      'the local build /broken cannot be installed',
    )
    await expect(setupWidgetsRelease(pinOf('a'.repeat(64)), { overrideDir: '/none' }, n.mechanisms)).rejects.toThrow(
      'OPENPLC_HMI_WIDGETS_DIR=/none has no openplc-hmi-widgets.json',
    )
  })

  it('reads the pin from binary-versions.json and refuses an incomplete one', () => {
    const pin = { version: 'v1.0.0', repository: 'Autonomy-Logic/openplc-hmi-widgets', manifestSha256: 'a'.repeat(64) }
    expect(widgetsReleasePin({ strucpp: {}, 'hmi-widgets': pin })).toEqual(pin)
    expect(() => widgetsReleasePin({ strucpp: {} })).toThrow('binary-versions.json needs an "hmi-widgets" entry')
    expect(() => widgetsReleasePin({ 'hmi-widgets': { ...pin, manifestSha256: 'x' } })).toThrow(WidgetsSetupError)
  })
})
