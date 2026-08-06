import { PackageManifestSchema } from '../package-manifest-schema'

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
