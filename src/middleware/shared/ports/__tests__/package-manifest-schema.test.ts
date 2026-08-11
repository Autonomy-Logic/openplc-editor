import { PackageManifestSchema, parseInstalledPackageManifest } from '../package-manifest-schema'

/** A minimal manifest the schema accepts, with room to override `package`. */
const manifest = (pkg: Record<string, unknown> = {}) => ({
  formatVersion: '1.0',
  package: { id: 'vendor.board', name: 'Vendor Board', version: '1.0.0', ...pkg },
  devices: [{ id: 'slm-rp4', name: 'SLM-RP4' }],
})

describe('PackageManifestSchema — compatibility floors', () => {
  it('accepts a manifest that declares no floors at all', () => {
    // Packages built before DOPE-448 must keep installing.
    expect(PackageManifestSchema.safeParse(manifest()).success).toBe(true)
  })

  // These are the shorthands a human writes by hand. Each means exactly its
  // zero-filled equivalent and is enforced as such, so accepting them here is
  // not leniency — it is the same rule the comparator applies.
  it.each([
    ['4.3.2', 'a full triple'],
    ['v4.3.2', 'a tag-style v prefix'],
    ['4.3', 'a two-part shorthand'],
    ['4', 'a bare major'],
    ['v5', 'a v-prefixed bare major'],
    ['4.3.2-rc.1', 'a pre-release'],
    ['4.3.2+build.5', 'a build suffix'],
  ])('accepts minEditorVersion %p (%s)', (minEditorVersion) => {
    expect(PackageManifestSchema.safeParse(manifest({ minEditorVersion })).success).toBe(true)
  })

  // The reason this check exists: an unreadable floor is not inert. The
  // comparator treats it as "declares nothing", so the package installs
  // everywhere while its author believes a constraint is being enforced.
  // A sideloaded `.vpp` never passes through openplc-packages' validator, so
  // for that entry path this schema is the only boundary there is.
  it.each([
    ['garbage', 'a non-version word'],
    ['next', 'a channel name mistaken for a version'],
    ['4,3,0', 'the wrong separator'],
    ['4.3 or newer', 'prose'],
    ['   ', 'whitespace only'],
    ['', 'an empty string'],
  ])('rejects minEditorVersion %p (%s)', (minEditorVersion) => {
    expect(PackageManifestSchema.safeParse(manifest({ minEditorVersion })).success).toBe(false)
  })

  it('applies the same rule to minRuntimeVersion', () => {
    expect(PackageManifestSchema.safeParse(manifest({ minRuntimeVersion: '4.2' })).success).toBe(true)
    expect(PackageManifestSchema.safeParse(manifest({ minRuntimeVersion: 'garbage' })).success).toBe(false)
  })

  it('names the offending field so the install error is actionable', () => {
    const result = PackageManifestSchema.safeParse(manifest({ minEditorVersion: 'garbage' }))
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0].path).toEqual(['package', 'minEditorVersion'])
    expect(result.error.issues[0].message).toContain('must be a version')
  })

  it('still lets unknown fields through untouched', () => {
    // The editor stays agnostic to manifest contents; the floors are the
    // deliberate exception, not a new general policy.
    const result = PackageManifestSchema.safeParse(manifest({ vendorExtension: { anything: true } }))
    expect(result.success).toBe(true)
  })
})

// The other half of the same rule: strict where a package ENTERS the editor,
// tolerant where an installed one is READ BACK. Without this split, the format
// check above would retroactively unresolve a package installed by an older
// editor — its boards would vanish from the board lookup with no message, on an
// upgrade where the user did nothing.
describe('parseInstalledPackageManifest — the load path', () => {
  let warnSpy: jest.SpyInstance

  beforeEach(() => {
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('reads a well-formed manifest exactly as the strict parser does', () => {
    const parsed = parseInstalledPackageManifest(manifest({ minEditorVersion: '4.3' }))
    expect(parsed?.package.minEditorVersion).toBe('4.3')
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it.each([
    ['minEditorVersion', 'garbage'],
    ['minRuntimeVersion', '4,3,0'],
  ])('drops an uncomparable %s and keeps the package readable', (field, value) => {
    const parsed = parseInstalledPackageManifest(manifest({ [field]: value }))

    // The package still resolves — this is the whole point — and the floor it
    // could never have enforced is simply gone.
    expect(parsed?.package.id).toBe('vendor.board')
    expect(parsed?.package).not.toHaveProperty(field)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(field))
  })

  it('drops a floor that is not even a string', () => {
    const parsed = parseInstalledPackageManifest(manifest({ minEditorVersion: 43 }))
    expect(parsed?.package).not.toHaveProperty('minEditorVersion')
  })

  it('drops only the unreadable floor, leaving the readable one enforced', () => {
    const parsed = parseInstalledPackageManifest(manifest({ minEditorVersion: 'garbage', minRuntimeVersion: '4.2' }))
    expect(parsed?.package).not.toHaveProperty('minEditorVersion')
    expect(parsed?.package.minRuntimeVersion).toBe('4.2')
  })

  it('leaves every other field of the package untouched', () => {
    const parsed = parseInstalledPackageManifest(
      manifest({ minEditorVersion: 'garbage', vendorExtension: { anything: true } }),
    )
    expect(parsed?.package).toMatchObject({
      id: 'vendor.board',
      name: 'Vendor Board',
      version: '1.0.0',
      vendorExtension: { anything: true },
    })
  })

  it('still rejects a manifest that is malformed for any other reason', () => {
    // Tolerance is scoped to the floors. A document missing `devices` is not a
    // manifest, and reading it as one would crash deeper in the loader.
    expect(parseInstalledPackageManifest({ formatVersion: '1.0', package: { id: 'x' } })).toBeNull()
  })

  it.each([
    ['a non-object', 'not a manifest'],
    ['null', null],
    ['an array', []],
    ['a manifest whose package is not an object', { formatVersion: '1.0', package: 'nope', devices: [{ id: 'a' }] }],
  ])('passes %s straight to the schema rather than guessing at it', (_label, value) => {
    expect(parseInstalledPackageManifest(value)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Board-manager URL
//
// The URL becomes an `--additional-urls` argument to arduino-cli, which then
// downloads a board package containing toolchain executables. The manifest
// signature vouches for the URL, not for what it serves — and arduino-cli's
// package checksums live inside the index it fetches, so a plaintext index is
// MITM-able.
// ---------------------------------------------------------------------------

/** A manifest whose single device carries the given `target`. */
const withTarget = (target: Record<string, unknown>) => ({
  formatVersion: '1.0',
  package: { id: 'vendor.board', name: 'Vendor Board', version: '1.0.0' },
  devices: [{ id: 'esp32-plc-21', name: 'ESP32 PLC 21', target }],
})

const VENDOR_INDEX = 'https://apps.industrialshields.com/main/arduino/boards/package_industrialshields_index.json'

describe('PackageManifestSchema — board manager URL', () => {
  it('accepts a device that declares no target at all', () => {
    expect(PackageManifestSchema.safeParse(manifest()).success).toBe(true)
  })

  it('accepts a target with no board manager URL', () => {
    expect(PackageManifestSchema.safeParse(withTarget({ type: 'arduino-cli', core: 'arduino:avr' })).success).toBe(true)
  })

  it('accepts the real https vendor index', () => {
    expect(PackageManifestSchema.safeParse(withTarget({ boardManagerUrl: VENDOR_INDEX })).success).toBe(true)
  })

  it('accepts a compressed index — the scheme is constrained, not the suffix', () => {
    // arduino-cli reads .json.gz / .zip / .bz2 indexes too.
    expect(PackageManifestSchema.safeParse(withTarget({ boardManagerUrl: 'https://x.dev/i.json.gz' })).success).toBe(
      true,
    )
  })

  it.each([
    ['plaintext http', 'http://x.dev/package_index.json'],
    ['a local file', 'file:///etc/passwd'],
    ['a bare path', '/tmp/package_index.json'],
    ['junk', 'not a url'],
    ['an empty string', ''],
  ])('rejects %s', (_label, url) => {
    const result = PackageManifestSchema.safeParse(withTarget({ boardManagerUrl: url }))
    expect(result.success).toBe(false)
  })

  it('leaves the rest of target untouched', () => {
    const parsed = PackageManifestSchema.safeParse(
      withTarget({ type: 'arduino-cli', core: 'industrialshields:esp32', boardManagerUrl: VENDOR_INDEX }),
    )
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.devices[0]).toMatchObject({
        target: { type: 'arduino-cli', core: 'industrialshields:esp32', boardManagerUrl: VENDOR_INDEX },
      })
    }
  })
})

describe('parseInstalledPackageManifest — board manager URL', () => {
  it('keeps a usable URL', () => {
    const parsed = parseInstalledPackageManifest(withTarget({ boardManagerUrl: VENDOR_INDEX }))
    expect(parsed?.devices[0].target.boardManagerUrl).toBe(VENDOR_INDEX)
  })

  it('drops a non-https URL instead of hiding every board in the package', () => {
    // A package installed before this constraint existed must keep loading;
    // rejecting it would make its boards vanish on an upgrade the user did
    // not ask for.
    const parsed = parseInstalledPackageManifest(
      withTarget({ type: 'arduino-cli', core: 'x:y', boardManagerUrl: 'http://x.dev/i.json' }),
    )
    expect(parsed).not.toBeNull()
    expect(parsed?.devices[0].target.boardManagerUrl).toBeUndefined()
    // Everything else about the device survives.
    expect(parsed?.devices[0]).toMatchObject({ id: 'esp32-plc-21', target: { type: 'arduino-cli', core: 'x:y' } })
  })

  it('leaves a device with no target alone', () => {
    expect(parseInstalledPackageManifest(manifest())).not.toBeNull()
  })
})
