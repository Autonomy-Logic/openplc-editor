/**
 * The interesting behaviour here is not the formatting — it is WHEN no file is
 * emitted, because the runtime reads an absent `retain.conf` as "remove the copy
 * you have" and that is what switches the built-in store off.
 */

import type { PersistentStorageSettings } from '../../../../middleware/shared/ports/types'
import { RETAIN_MAX_FLUSH_SECONDS, RETAIN_MIN_FLUSH_SECONDS } from '../../../../middleware/shared/ports/types'
import { generateRetainConf } from '../steps/generate-retain-conf'

const on = (over: Partial<PersistentStorageSettings> = {}): PersistentStorageSettings => ({
  enabled: true,
  path: '/var/lib/openplc-runtime/retain.bin',
  flushSeconds: 5,
  ...over,
})

describe('generateRetainConf', () => {
  it('emits the keys the core parses, in the flat key=value form it expects', () => {
    const out = generateRetainConf({ settings: on({ path: '/data/retain.bin', flushSeconds: 12 }) })

    expect(out).toContain('enabled=1\n')
    expect(out).toContain('path=/data/retain.bin\n')
    expect(out).toContain('flush_seconds=12\n')
  })

  it('emits nothing for a project that never configured storage', () => {
    expect(generateRetainConf({ settings: undefined })).toBeNull()
  })

  it('emits nothing when the project turned storage off', () => {
    // Not the same as "no settings", but it has to mean the same thing on the
    // wire: the runtime deletes its copy, so the store stays off.
    expect(generateRetainConf({ settings: on({ enabled: false }) })).toBeNull()
  })

  it('emits nothing when the target handles retention in its own driver', () => {
    // This is the case that makes two live stores unrepresentable: the vendor's
    // driver is the only candidate because the built-in one gets no config.
    expect(generateRetainConf({ settings: on({ enabled: true }), targetHidesPersistentStorage: true })).toBeNull()
  })

  it('leaves an empty path empty, so the runtime supplies its own default', () => {
    const out = generateRetainConf({ settings: on({ path: '' }) })
    expect(out).toContain('path=\n')
  })

  it('trims a path the user left padded', () => {
    const out = generateRetainConf({ settings: on({ path: '  /data/retain.bin  ' }) })
    expect(out).toContain('path=/data/retain.bin\n')
  })

  it('clamps a hand-edited period to what the runtime would accept', () => {
    expect(generateRetainConf({ settings: on({ flushSeconds: 0 }) })).toContain(
      `flush_seconds=${RETAIN_MIN_FLUSH_SECONDS}\n`,
    )
    expect(generateRetainConf({ settings: on({ flushSeconds: 99999 }) })).toContain(
      `flush_seconds=${RETAIN_MAX_FLUSH_SECONDS}\n`,
    )
  })

  it('rounds a fractional period rather than emitting one the core cannot parse', () => {
    expect(generateRetainConf({ settings: on({ flushSeconds: 7.6 }) })).toContain('flush_seconds=8\n')
  })

  it('falls back to the floor for a period that is not a number at all', () => {
    expect(generateRetainConf({ settings: on({ flushSeconds: Number.NaN }) })).toContain(
      `flush_seconds=${RETAIN_MIN_FLUSH_SECONDS}\n`,
    )
  })

  it('says in the file that the project owns these settings', () => {
    // The file lands in the runtime root next to hand-editable configs, so it
    // has to tell whoever opens it that an upload will overwrite their edit.
    const out = generateRetainConf({ settings: on() })
    expect(out).toContain('overwritten')
  })
})
