// Pins come only from fingerprints the user typed, never from what a connection presented.

import { createHash } from 'crypto'
import { z } from 'zod'

import { normalizeRuntimeCertificateFingerprint } from '../../../frontend/utils/mqtt/credentials/runtime-identity'
import type {
  RuntimeIdentityPin,
  RuntimeIdentityWriteResult,
} from '../../../middleware/shared/ports/runtime-identity-port'
import type { OwnerOnlyTextFile } from '../utils/owner-only-file'

export const RUNTIME_IDENTITY_FORMAT = 'openplc-editor-runtime-identity'
export const RUNTIME_IDENTITY_VERSION = 1
export const RUNTIME_IDENTITY_MAX_PINS = 256
export const RUNTIME_IDENTITY_DIR = 'runtime-identity'
export const RUNTIME_IDENTITY_FILE = 'pins.json'
export const RUNTIME_IDENTITY_MAX_BYTES = 256 * 1024

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

export const RuntimeTargetKeySchema = z
  .string()
  .min(1)
  .max(512)
  .refine((value) => !CONTROL.test(value) && value.trim() === value, 'invalid target key')

const PinSchema = z
  .object({
    targetKey: RuntimeTargetKeySchema,
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    updatedAt: z.string().max(64),
  })
  .strict()

const DocumentSchema = z
  .object({
    format: z.literal(RUNTIME_IDENTITY_FORMAT),
    version: z.literal(RUNTIME_IDENTITY_VERSION),
    pins: z.array(PinSchema).max(RUNTIME_IDENTITY_MAX_PINS),
  })
  .strict()

type IdentityDocument = z.infer<typeof DocumentSchema>

export interface RuntimeIdentityStore {
  get(targetKey: string): Promise<RuntimeIdentityPin | null>
  set(targetKey: string, fingerprint: string): Promise<RuntimeIdentityWriteResult>
  remove(targetKey: string): Promise<void>
}

export interface RuntimeIdentityStoreDeps {
  storage: OwnerOnlyTextFile
  log: (level: 'info' | 'warn', line: string) => void
  now?: () => Date
}

/** Names a pin in log lines without the address it belongs to. */
export const runtimeIdentityEntryLabel = (targetKey: string): string =>
  createHash('sha256').update(targetKey).digest('hex').slice(0, 12)

const emptyDocument = (): IdentityDocument => ({
  format: RUNTIME_IDENTITY_FORMAT,
  version: RUNTIME_IDENTITY_VERSION,
  pins: [],
})

export const createRuntimeIdentityStore = ({
  storage,
  log,
  now = () => new Date(),
}: RuntimeIdentityStoreDeps): RuntimeIdentityStore => {
  let queue: Promise<unknown> = Promise.resolve()
  const serialize = <T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.then(task, task)
    queue = next.catch(() => undefined)
    return next
  }

  const load = async (): Promise<IdentityDocument> => {
    let raw: string | null
    try {
      raw = await storage.read()
    } catch {
      log('warn', 'Runtime identity: event=read result=unreadable')
      return emptyDocument()
    }
    if (raw === null) return emptyDocument()
    try {
      const parsed = DocumentSchema.safeParse(JSON.parse(raw))
      if (parsed.success) return parsed.data
    } catch {
      // Falls through to the corrupt case.
    }
    log('warn', 'Runtime identity: event=read result=corrupt')
    return emptyDocument()
  }

  return {
    get: (targetKey) =>
      serialize(async () => {
        if (!RuntimeTargetKeySchema.safeParse(targetKey).success) return null
        const pin = (await load()).pins.find((entry) => entry.targetKey === targetKey)
        return pin ? { sha256: pin.sha256, updatedAt: pin.updatedAt } : null
      }),

    set: (targetKey, fingerprint) =>
      serialize(async (): Promise<RuntimeIdentityWriteResult> => {
        const sha256 = normalizeRuntimeCertificateFingerprint(fingerprint)
        if (!RuntimeTargetKeySchema.safeParse(targetKey).success || sha256 === null) {
          return {
            ok: false,
            code: 'runtime_identity_invalid',
            message: 'Enter the SHA-256 fingerprint of the runtime certificate (64 hexadecimal digits).',
          }
        }
        const document = await load()
        const others = document.pins.filter((entry) => entry.targetKey !== targetKey)
        if (others.length >= RUNTIME_IDENTITY_MAX_PINS) {
          return {
            ok: false,
            code: 'runtime_identity_unavailable',
            message: 'Too many trusted runtimes are stored; forget one first.',
          }
        }
        const pin = { targetKey, sha256, updatedAt: now().toISOString() }
        try {
          await storage.write(JSON.stringify({ ...document, pins: [...others, pin] }))
        } catch {
          log('warn', `Runtime identity: event=set result=failed entry=${runtimeIdentityEntryLabel(targetKey)}`)
          return { ok: false, code: 'runtime_identity_unavailable', message: 'The trusted runtime could not be saved.' }
        }
        log(
          'info',
          `Runtime identity: event=set result=ok entry=${runtimeIdentityEntryLabel(targetKey)} sha256=${sha256.slice(0, 16)}`,
        )
        return { ok: true, pin: { sha256, updatedAt: pin.updatedAt } }
      }),

    remove: (targetKey) =>
      serialize(async () => {
        const document = await load()
        const pins = document.pins.filter((entry) => entry.targetKey !== targetKey)
        if (pins.length === document.pins.length) return
        await storage.write(JSON.stringify({ ...document, pins }))
        log('info', `Runtime identity: event=remove result=ok entry=${runtimeIdentityEntryLabel(targetKey)}`)
      }),
  }
}
