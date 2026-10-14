/** @jest-environment node */

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createOwnerOnlyTextFile } from '../../utils/owner-only-file'
import {
  createRuntimeIdentityStore,
  RUNTIME_IDENTITY_DIR,
  RUNTIME_IDENTITY_FILE,
  RUNTIME_IDENTITY_MAX_BYTES,
  RUNTIME_IDENTITY_MAX_PINS,
  runtimeIdentityEntryLabel,
} from '../runtime-identity-store'

const HEX = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08'
const OTHER = 'aa'.repeat(32)
const TARGET = 'address:192.168.10.20'

let profile = ''
let lines: string[] = []

const store = () =>
  createRuntimeIdentityStore({
    storage: createOwnerOnlyTextFile(
      join(profile, RUNTIME_IDENTITY_DIR),
      RUNTIME_IDENTITY_FILE,
      RUNTIME_IDENTITY_MAX_BYTES,
      'runtime identity',
    ),
    log: (_level, line) => lines.push(line),
    now: () => new Date('2026-10-12T10:00:00.000Z'),
  })

const file = () => join(profile, RUNTIME_IDENTITY_DIR, RUNTIME_IDENTITY_FILE)

beforeEach(() => {
  profile = mkdtempSync(join(tmpdir(), 'runtime-identity-'))
  lines = []
})

afterEach(() => {
  rmSync(profile, { recursive: true, force: true })
})

describe('runtime identity store', () => {
  it('pins a fingerprint for one target, owner-only, and reads it back after a restart', async () => {
    const result = await store().set(TARGET, `SHA256 Fingerprint=${HEX.toUpperCase().match(/.{2}/g)?.join(':')}`)
    expect(result).toEqual({ ok: true, pin: { sha256: HEX, updatedAt: '2026-10-12T10:00:00.000Z' } })
    expect(await store().get(TARGET)).toEqual({ sha256: HEX, updatedAt: '2026-10-12T10:00:00.000Z' })
    expect(await store().get('address:192.168.10.21')).toBeNull()
    expect(statSync(file()).mode & 0o777).toBe(0o600)
    expect(statSync(join(profile, RUNTIME_IDENTITY_DIR)).mode & 0o777).toBe(0o700)
    expect(readdirSync(join(profile, RUNTIME_IDENTITY_DIR))).toEqual([RUNTIME_IDENTITY_FILE])
  })

  it('replaces the pin of a target and forgets it on removal', async () => {
    const identity = store()
    await identity.set(TARGET, HEX)
    await identity.set(TARGET, OTHER)
    expect((await identity.get(TARGET))?.sha256).toBe(OTHER)
    expect(JSON.parse(readFileSync(file(), 'utf-8')).pins).toHaveLength(1)
    await identity.remove(TARGET)
    expect(await identity.get(TARGET)).toBeNull()
    await identity.remove(TARGET)
  })

  it('refuses a malformed fingerprint or target key and writes nothing', async () => {
    const identity = store()
    expect(await identity.set(TARGET, HEX.slice(2))).toMatchObject({ ok: false, code: 'runtime_identity_invalid' })
    expect(await identity.set(' address:x', HEX)).toMatchObject({ ok: false, code: 'runtime_identity_invalid' })
    expect(await identity.set('address:\u0000', HEX)).toMatchObject({ ok: false, code: 'runtime_identity_invalid' })
    expect(await identity.get('address:\u0000')).toBeNull()
    expect(() => statSync(file())).toThrow()
  })

  it('treats a corrupt or foreign file as no pin, so nothing is trusted by accident', async () => {
    await store().set(TARGET, HEX)
    writeFileSync(file(), '{"format":"openplc-editor-runtime-identity","version":1,"pins":[{"targetKey":"x"}]}')
    expect(await store().get(TARGET)).toBeNull()
    writeFileSync(file(), 'not json')
    expect(await store().get(TARGET)).toBeNull()
    expect(lines).toContain('Runtime identity: event=read result=corrupt')
  })

  it('caps the number of pinned runtimes', async () => {
    const identity = store()
    for (let i = 0; i < RUNTIME_IDENTITY_MAX_PINS; i += 1) {
      expect((await identity.set(`address:10.0.${Math.floor(i / 250)}.${i % 250}`, HEX)).ok).toBe(true)
    }
    expect(await identity.set('address:10.9.9.9', HEX)).toMatchObject({
      ok: false,
      code: 'runtime_identity_unavailable',
    })
    expect((await identity.set('address:10.0.0.0', OTHER)).ok).toBe(true)
  })

  it('logs entries by label, never by address', async () => {
    const identity = store()
    await identity.set(TARGET, HEX)
    await identity.remove(TARGET)
    expect(lines.join('\n')).not.toContain('192.168.10.20')
    expect(lines).toContain(
      `Runtime identity: event=set result=ok entry=${runtimeIdentityEntryLabel(TARGET)} sha256=${HEX.slice(0, 16)}`,
    )
  })
})
