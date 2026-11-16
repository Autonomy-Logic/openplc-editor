import { describe, expect, it } from '@jest/globals'

import { cleanStateFingerprint, ownedSliceFingerprint, serializeOwnedSlice } from '../owned-slice'

const OWNED = ['configurator', 'device-setup', 'io-mapping']
const ARCHIVE_KEYS = ['configurator']

function data(archive: string, alias = '') {
  return {
    configurator: { archive, controller: 'UC20-M3000', bundleVersion: '3.5.22' },
    'device-setup': { modules: [{ guid: 'g1', instanceName: 'M1', typeId: 'T', slot: 1 }] },
    'io-mapping': { entries: [{ slot: 1, channelName: 'input_image_1', alias }] },
    'hal-config': { unrelated: true },
  }
}

describe('owned slice', () => {
  it('keeps the full archive in cleanState so a revert restores it byte-for-byte', () => {
    const archive = 'x'.repeat(10_000)
    const clean: unknown = JSON.parse(serializeOwnedSlice(data(archive), OWNED))

    expect(clean).toMatchObject({ configurator: { archive } })
  })

  it('fingerprints the archive by hash instead of carrying it', () => {
    const archive = 'x'.repeat(10_000)
    const fingerprint = ownedSliceFingerprint(data(archive), OWNED, ARCHIVE_KEYS)

    expect(fingerprint).not.toContain(archive)
    expect(fingerprint.length).toBeLessThan(1_000)
  })

  it('is clean when nothing changed since cleanState was taken', () => {
    const clean = serializeOwnedSlice(data('archive-a'), OWNED)

    expect(ownedSliceFingerprint(data('archive-a'), OWNED, ARCHIVE_KEYS)).toBe(
      cleanStateFingerprint(clean, ARCHIVE_KEYS),
    )
  })

  it('is dirty when the archive changed', () => {
    const clean = serializeOwnedSlice(data('archive-a'), OWNED)

    expect(ownedSliceFingerprint(data('archive-b'), OWNED, ARCHIVE_KEYS)).not.toBe(
      cleanStateFingerprint(clean, ARCHIVE_KEYS),
    )
  })

  it('is dirty when an alias changed', () => {
    const clean = serializeOwnedSlice(data('archive-a'), OWNED)

    expect(ownedSliceFingerprint(data('archive-a', 'Pump'), OWNED, ARCHIVE_KEYS)).not.toBe(
      cleanStateFingerprint(clean, ARCHIVE_KEYS),
    )
  })

  it('ignores keys the screen does not own', () => {
    const clean = serializeOwnedSlice(data('archive-a'), OWNED)
    const changed = { ...data('archive-a'), 'hal-config': { unrelated: false } }

    expect(ownedSliceFingerprint(changed, OWNED, ARCHIVE_KEYS)).toBe(cleanStateFingerprint(clean, ARCHIVE_KEYS))
  })

  it('falls back to the raw cleanState when it is not a JSON object', () => {
    expect(cleanStateFingerprint('not json', ARCHIVE_KEYS)).toBe('not json')
  })
})
