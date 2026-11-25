import { HMI_CORE_API_VERSION, WIDGETS_RELEASE_SUMS } from '../../../../../middleware/shared/utils/hmi/widget-libraries'
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
const RELEASE_BASE = 'https://github.com/Autonomy-Logic/openplc-hmi-widgets/releases/download/v1.1.1/'

interface ReleaseFiles {
  files: Map<string, Uint8Array>
  sumsSha256: string
}

/** A release whose SHA256SUMS lists its licence and archives, the way the release build writes it. */
async function makeRelease(options: { hmiCoreApi?: number; tamper?: string } = {}): Promise<ReleaseFiles> {
  const core = String(options.hmiCoreApi ?? HMI_CORE_API_VERSION)
  const archives = [
    {
      name: 'hmi-alarms',
      headers: [],
      text: JSON.stringify({
        manifest: { name: 'hmi-alarms', version: '1.0.0', headers: [] },
        chunks: [{ name: 'HMI_ALARM', kind: 'function', deps: [] }],
        dependencies: [],
      }),
    },
    {
      name: 'standard-widgets',
      headers: ['hmi_core.h'],
      text: JSON.stringify({
        manifest: {
          name: 'standard-widgets',
          version: '1.0.0',
          headers: ['hmi_core.h'],
          headerVersions: { 'hmi_core.h': core },
        },
        chunks: [
          { name: 'HMIELEMENT', kind: 'functionBlock', deps: [], headers: [{ name: 'hmi_core.h', version: core }] },
        ],
        dependencies: [],
      }),
    },
  ]
  const files = new Map<string, Uint8Array>([['LICENSE', encoder.encode('GPLv3')]])
  for (const a of archives) files.set(`${a.name}.stlib`, encoder.encode(a.text))
  const lines = []
  for (const [name, bytes] of files) lines.push(`${await sha256Hex(bytes)}  ${name}`)
  const sums = encoder.encode(`${lines.join('\n')}\n`)
  files.set(WIDGETS_RELEASE_SUMS, sums)
  if (options.tamper) files.set(options.tamper, encoder.encode('{"manifest":{"name":"tampered"}}'))
  return { files, sumsSha256: await sha256Hex(sums) }
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
  version: 'v1.1.1',
  repository: 'Autonomy-Logic/openplc-hmi-widgets',
  sumsSha256: sha,
})

describe('HMI widgets release setup', () => {
  it('downloads the pinned release, checking SHA256SUMS against the pin and every file it lists against it', async () => {
    const release = await makeRelease()
    const m = memory(release.files)
    const result = await setupWidgetsRelease(pinOf(release.sumsSha256), {}, m.mechanisms)
    expect(result).toEqual({ source: 'release', libraries: ['hmi-alarms', 'standard-widgets'] })
    expect(m.fetched).toEqual([
      `${RELEASE_BASE}${WIDGETS_RELEASE_SUMS}`,
      `${RELEASE_BASE}LICENSE`,
      `${RELEASE_BASE}hmi-alarms.stlib`,
      `${RELEASE_BASE}standard-widgets.stlib`,
    ])
    expect([...m.installed.keys()].sort()).toEqual(
      ['LICENSE', WIDGETS_RELEASE_SUMS, 'hmi-alarms.stlib', 'standard-widgets.stlib'].sort(),
    )
  })

  it('skips the download when the pinned release is installed and intact, and repairs it when it is not', async () => {
    const release = await makeRelease()
    const m = memory(release.files)
    await setupWidgetsRelease(pinOf(release.sumsSha256), {}, m.mechanisms)
    m.fetched.length = 0
    expect((await setupWidgetsRelease(pinOf(release.sumsSha256), {}, m.mechanisms)).source).toBe('installed')
    expect(m.fetched).toEqual([])
    m.installed.set('standard-widgets.stlib', encoder.encode('{}'))
    expect((await setupWidgetsRelease(pinOf(release.sumsSha256), {}, m.mechanisms)).source).toBe('release')
    expect(decoder.decode(m.installed.get('standard-widgets.stlib'))).toContain('"name":"HMIELEMENT"')
  })

  it('refuses a release whose SHA256SUMS does not match the pin, and installs nothing', async () => {
    const release = await makeRelease()
    const m = memory(release.files)
    const pinned = 'f'.repeat(64)
    await expect(setupWidgetsRelease(pinOf(pinned), {}, m.mechanisms)).rejects.toThrow(
      `has SHA-256 ${release.sumsSha256}, but binary-versions.json pins ${pinned}`,
    )
    expect(m.writes()).toBe(0)
  })

  it('refuses a release whose archive does not match SHA256SUMS, and installs nothing', async () => {
    const release = await makeRelease({ tamper: 'standard-widgets.stlib' })
    const m = memory(release.files)
    await expect(setupWidgetsRelease(pinOf(release.sumsSha256), {}, m.mechanisms)).rejects.toThrow(
      /standard-widgets\.stlib has SHA-256 [0-9a-f]{64}, SHA256SUMS says/,
    )
    expect(m.writes()).toBe(0)
  })

  it('refuses a release built for another HMI core API', async () => {
    const release = await makeRelease({ hmiCoreApi: HMI_CORE_API_VERSION + 1 })
    const m = memory(release.files)
    await expect(setupWidgetsRelease(pinOf(release.sumsSha256), {}, m.mechanisms)).rejects.toThrow(
      `standard-widgets.stlib is built for HMI core API ${HMI_CORE_API_VERSION + 1}, but this editor provides HMI ` +
        `core API ${HMI_CORE_API_VERSION}`,
    )
    expect(m.writes()).toBe(0)
  })

  it('fails with what to do when the release is not published and no local build is named', async () => {
    const m = memory(null)
    const error = await setupWidgetsRelease(pinOf('a'.repeat(64)), {}, m.mechanisms).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(WidgetsSetupError)
    expect(error instanceof Error && error.message).toBe(
      'The HMI widgets release v1.1.1 is not published on Autonomy-Logic/openplc-hmi-widgets ' +
        `(${RELEASE_BASE}${WIDGETS_RELEASE_SUMS} was not found). Set OPENPLC_HMI_WIDGETS_DIR to a local ` +
        'openplc-hmi-widgets build directory (its dist/) to set up without it.',
    )
  })

  it('installs a local build instead of the release, checking it the same way and saying it differs from the pin', async () => {
    const build = await makeRelease()
    const m = memory(null, { '/build/dist': build.files })
    const result = await setupWidgetsRelease(pinOf('a'.repeat(64)), { overrideDir: '/build/dist' }, m.mechanisms)
    expect(result).toEqual({ source: 'override', libraries: ['hmi-alarms', 'standard-widgets'] })
    expect(m.fetched).toEqual([])
    expect(m.logs).toEqual([expect.stringContaining('differs from the pinned v1.1.1')])
    expect(
      (await setupWidgetsRelease(pinOf('a'.repeat(64)), { overrideDir: '/build/dist' }, m.mechanisms)).source,
    ).toBe('installed')
    const broken = await makeRelease({ tamper: 'hmi-alarms.stlib' })
    const n = memory(null, { '/broken': broken.files })
    await expect(setupWidgetsRelease(pinOf('a'.repeat(64)), { overrideDir: '/broken' }, n.mechanisms)).rejects.toThrow(
      'the local build /broken cannot be installed',
    )
    await expect(setupWidgetsRelease(pinOf('a'.repeat(64)), { overrideDir: '/none' }, n.mechanisms)).rejects.toThrow(
      'OPENPLC_HMI_WIDGETS_DIR=/none has no SHA256SUMS',
    )
  })

  it('reads the pin from binary-versions.json and refuses an incomplete one', () => {
    const pin = { version: 'v1.1.1', repository: 'Autonomy-Logic/openplc-hmi-widgets', sumsSha256: 'a'.repeat(64) }
    expect(widgetsReleasePin({ strucpp: {}, 'hmi-widgets': pin })).toEqual(pin)
    expect(() => widgetsReleasePin({ strucpp: {} })).toThrow('binary-versions.json needs an "hmi-widgets" entry')
    expect(() => widgetsReleasePin({ 'hmi-widgets': { ...pin, sumsSha256: 'x' } })).toThrow(WidgetsSetupError)
  })
})
