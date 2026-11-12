import type { HostKeyFileReadResult } from '@root/middleware/shared/ports/runtime-provisioning-mechanisms'
import { SshPortSchema } from '@root/middleware/shared/ports/runtime-provisioning-port'
import { z } from 'zod'

export interface HostKeyEntry {
  host: string
  port: number
  keyType: string
  key: string
  firstSeen: string
}

export type HostKeyFileState =
  | { kind: 'absent' }
  | { kind: 'valid'; entries: HostKeyEntry[] }
  | { kind: 'unusable'; reason: 'empty' | 'invalid' | 'unreadable' }

export type HostKeyDecision =
  | { kind: 'match' }
  | { kind: 'first-use'; nextFileText: string }
  | { kind: 'changed' }
  | { kind: 'unusable' }

const HOST_KEY_FILE_VERSION = 1

const HostKeyEntrySchema = z
  .object({
    host: z.string().min(1),
    port: SshPortSchema,
    keyType: z.string().min(1),
    key: z.string().min(1),
    firstSeen: z.string().min(1),
  })
  .strict()

const HostKeyFileSchema = z
  .object({
    version: z.literal(HOST_KEY_FILE_VERSION),
    hosts: z.array(HostKeyEntrySchema),
  })
  .strict()

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const SSH_STRING_LENGTH_BYTES = 4
const KEY_TYPE_MAX_LENGTH = 64
const PRINTABLE_ASCII_FIRST = 0x21
const PRINTABLE_ASCII_LAST = 0x7e

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  try {
    const value: unknown = JSON.parse(text)
    return { ok: true, value }
  } catch {
    return { ok: false }
  }
}

function sameTarget(entry: HostKeyEntry, target: { host: string; port: number }): boolean {
  return entry.host === target.host && entry.port === target.port
}

function hasDuplicateTargets(entries: HostKeyEntry[]): boolean {
  const targets = new Set(entries.map((entry) => JSON.stringify([entry.host, entry.port])))
  return targets.size !== entries.length
}

export function parseHostKeyFile(read: HostKeyFileReadResult): HostKeyFileState {
  if (read.kind === 'absent') return { kind: 'absent' }
  if (read.kind === 'error') return { kind: 'unusable', reason: 'unreadable' }
  if (read.text.trim() === '') return { kind: 'unusable', reason: 'empty' }
  const json = parseJson(read.text)
  if (!json.ok) return { kind: 'unusable', reason: 'invalid' }
  const parsed = HostKeyFileSchema.safeParse(json.value)
  if (!parsed.success || hasDuplicateTargets(parsed.data.hosts)) return { kind: 'unusable', reason: 'invalid' }
  return { kind: 'valid', entries: parsed.data.hosts }
}

export function serializeHostKeyFile(entries: HostKeyEntry[]): string {
  const hosts = entries.map((entry) => ({
    host: entry.host,
    port: entry.port,
    keyType: entry.keyType,
    key: entry.key,
    firstSeen: entry.firstSeen,
  }))
  return `${JSON.stringify({ version: HOST_KEY_FILE_VERSION, hosts }, null, 2)}\n`
}

function decodeBase64(text: string): number[] | null {
  if (!BASE64.test(text)) return null
  return Array.from(atob(text), (character) => character.charCodeAt(0))
}

export function keyTypeFromBlob(keyBase64: string): string | null {
  const bytes = decodeBase64(keyBase64)
  if (bytes === null || bytes.length < SSH_STRING_LENGTH_BYTES) return null
  const length = bytes[0] * 0x1000000 + bytes[1] * 0x10000 + bytes[2] * 0x100 + bytes[3]
  const typeBytes = bytes.slice(SSH_STRING_LENGTH_BYTES, SSH_STRING_LENGTH_BYTES + length)
  if (length === 0 || length > KEY_TYPE_MAX_LENGTH || typeBytes.length !== length) return null
  if (!typeBytes.every((byte) => byte >= PRINTABLE_ASCII_FIRST && byte <= PRINTABLE_ASCII_LAST)) return null
  return String.fromCharCode(...typeBytes)
}

export function decideHostKey(
  state: HostKeyFileState,
  target: { host: string; port: number },
  keyBase64: string,
  nowIso: string,
): HostKeyDecision {
  if (state.kind === 'unusable') return { kind: 'unusable' }
  const entries = state.kind === 'valid' ? state.entries : []
  const remembered = entries.find((entry) => sameTarget(entry, target))
  if (remembered !== undefined) return remembered.key === keyBase64 ? { kind: 'match' } : { kind: 'changed' }
  const keyType = keyTypeFromBlob(keyBase64)
  if (keyType === null) return { kind: 'changed' }
  const added: HostKeyEntry = { host: target.host, port: target.port, keyType, key: keyBase64, firstSeen: nowIso }
  return { kind: 'first-use', nextFileText: serializeHostKeyFile([...entries, added]) }
}
