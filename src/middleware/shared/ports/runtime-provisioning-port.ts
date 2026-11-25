import { z } from 'zod'

import type { Unsubscribe } from './types'

const HOST_MAX_LENGTH = 253
const HOSTNAME_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/
const IPV6_CHARACTERS = /^[0-9A-Fa-f:.]+$/
const IPV6_GROUP = /^[0-9A-Fa-f]{1,4}$/
const IPV4_OCTET = /^(?:0|[1-9][0-9]{0,2})$/
const IPV6_GROUP_COUNT = 8

function isIpv4DottedQuad(text: string): boolean {
  const octets = text.split('.')
  return octets.length === 4 && octets.every((octet) => IPV4_OCTET.test(octet) && Number(octet) <= 255)
}

function ipv6Groups(text: string): string[] {
  return text === '' ? [] : text.split(':')
}

function isIpv6WithoutEmbeddedIpv4(text: string): boolean {
  const halves = text.split('::')
  if (halves.length > 2) return false
  if (halves.length === 1) {
    const groups = ipv6Groups(text)
    return groups.length === IPV6_GROUP_COUNT && groups.every((group) => IPV6_GROUP.test(group))
  }
  const groups = halves.flatMap(ipv6Groups)
  return groups.length < IPV6_GROUP_COUNT && groups.every((group) => IPV6_GROUP.test(group))
}

function isIpv6Literal(text: string): boolean {
  if (!text.includes(':') || !IPV6_CHARACTERS.test(text)) return false
  const lastColon = text.lastIndexOf(':')
  const tail = text.slice(lastColon + 1)
  if (!tail.includes('.')) return isIpv6WithoutEmbeddedIpv4(text)
  return isIpv4DottedQuad(tail) && isIpv6WithoutEmbeddedIpv4(`${text.slice(0, lastColon + 1)}0:0`)
}

function isHostname(text: string): boolean {
  return text.split('.').every((label) => HOSTNAME_LABEL.test(label))
}

function hasNoControlCharacters(text: string): boolean {
  return Array.from(text).every((character) => {
    const code = character.charCodeAt(0)
    return code > 0x1f && code !== 0x7f
  })
}

export const ProvisioningHostSchema: z.ZodType<string> = z
  .string()
  .min(1)
  .max(HOST_MAX_LENGTH)
  .refine((host) => isIpv6Literal(host) || isHostname(host))

export const SshPortSchema = z.number().int().min(1).max(65535)

const UsernameSchema = z.string().min(1).max(32).refine(hasNoControlCharacters)

const PasswordSchema = z.string().min(1).max(1024).refine(hasNoControlCharacters)

export const RuntimeProvisioningRunRequestSchema = z
  .object({
    host: ProvisioningHostSchema,
    port: SshPortSchema,
    username: UsernameSchema,
    password: PasswordSchema,
  })
  .strict()

export type RuntimeProvisioningRunRequest = z.infer<typeof RuntimeProvisioningRunRequestSchema>

export const SshProbeRequestSchema = z
  .object({
    host: ProvisioningHostSchema,
    port: SshPortSchema,
  })
  .strict()

export type SshProbeRequest = z.infer<typeof SshProbeRequestSchema>

export type RunRequestField = 'host' | 'port' | 'username' | 'password'

const RUN_REQUEST_FIELDS: readonly RunRequestField[] = ['host', 'port', 'username', 'password']

export function validateRunRequest(
  value: unknown,
): { ok: true; request: RuntimeProvisioningRunRequest } | { ok: false; field: RunRequestField | 'payload' } {
  const parsed = RuntimeProvisioningRunRequestSchema.safeParse(value)
  if (parsed.success) return { ok: true, request: parsed.data }
  const issues = parsed.error.issues
  if (issues.some((issue) => issue.path.length === 0)) return { ok: false, field: 'payload' }
  const field = RUN_REQUEST_FIELDS.find((name) => issues.some((issue) => issue.path[0] === name))
  return { ok: false, field: field ?? 'payload' }
}

export type SshProbeFailureReason = 'refused' | 'timeout' | 'unreachable' | 'not-ssh' | 'invalid-input'

export type SshProbeResult = { answered: true } | { answered: false; reason: SshProbeFailureReason }

export type RuntimeProvisioningOperation = 'start' | 'install'

export type RuntimeProvisioningOutcome =
  | { kind: 'connected-ready'; operation: RuntimeProvisioningOperation | 'none' }
  | { kind: 'not-started'; operation: RuntimeProvisioningOperation | 'none'; lastLines: string[] }
  | { kind: 'cancelled' }
  | { kind: 'unknown' }
  | { kind: 'busy' }
  | { kind: 'invalid-input'; field: RunRequestField | 'payload' }
  | { kind: 'ssh-unreachable' }
  | { kind: 'host-key-changed'; target: string }
  | { kind: 'host-key-file-unusable' }
  | { kind: 'host-key-not-saved' }
  | { kind: 'auth-rejected' }
  | { kind: 'password-auth-not-accepted' }
  | { kind: 'no-admin-rights' }
  | { kind: 'unsupported'; reason: 'os' | 'init' | 'arch'; detail: string }
  | { kind: 'v3-present' }
  | { kind: 'download-failed'; dockerPresent: boolean }
  | { kind: 'installer-failed'; lastLines: string[] }
  | { kind: 'start-failed'; lastLines: string[] }

export type RuntimeProvisioningPhase = 'connecting' | 'inspecting' | 'starting' | 'installing' | 'waiting-runtime'

export type RuntimeProvisioningEvent =
  | { type: 'phase'; phase: RuntimeProvisioningPhase; cancellable: boolean; operation?: RuntimeProvisioningOperation }
  | { type: 'output'; line: string }
  | { type: 'console'; level: 'info' | 'warning' | 'error'; message: string }
  | { type: 'audit'; line: string }

export interface RuntimeProvisioningPort {
  probeSsh(request: SshProbeRequest): Promise<SshProbeResult>
  run(request: RuntimeProvisioningRunRequest): Promise<RuntimeProvisioningOutcome>
  cancel(): Promise<void>
  onEvent(callback: (event: RuntimeProvisioningEvent) => void): Unsubscribe
}

type Fields = ReadonlyMap<string, unknown>

function fieldsOf(value: unknown): Fields | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  return new Map<string, unknown>(Object.entries(value))
}

function oneOf<T extends string>(options: readonly T[], value: unknown): T | undefined {
  return options.find((option) => option === value)
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

const PROVISIONING_PHASES: readonly RuntimeProvisioningPhase[] = [
  'connecting',
  'inspecting',
  'starting',
  'installing',
  'waiting-runtime',
]
const PROVISIONING_OPERATIONS: readonly RuntimeProvisioningOperation[] = ['start', 'install']
const OUTCOME_OPERATIONS: readonly (RuntimeProvisioningOperation | 'none')[] = ['start', 'install', 'none']
const CONSOLE_LEVELS: readonly ('info' | 'warning' | 'error')[] = ['info', 'warning', 'error']
const INVALID_INPUT_FIELDS: readonly (RunRequestField | 'payload')[] = [...RUN_REQUEST_FIELDS, 'payload']
const UNSUPPORTED_REASONS: readonly ('os' | 'init' | 'arch')[] = ['os', 'init', 'arch']
const PROBE_FAILURE_REASONS: readonly SshProbeFailureReason[] = [
  'refused',
  'timeout',
  'unreachable',
  'not-ssh',
  'invalid-input',
]

function toPhaseEvent(fields: Fields): RuntimeProvisioningEvent | null {
  const phase = oneOf(PROVISIONING_PHASES, fields.get('phase'))
  const cancellable = fields.get('cancellable')
  if (phase === undefined || typeof cancellable !== 'boolean') return null
  const rawOperation = fields.get('operation')
  if (rawOperation === undefined) return { type: 'phase', phase, cancellable }
  const operation = oneOf(PROVISIONING_OPERATIONS, rawOperation)
  return operation === undefined ? null : { type: 'phase', phase, cancellable, operation }
}

export function toRuntimeProvisioningEvent(value: unknown): RuntimeProvisioningEvent | null {
  const fields = fieldsOf(value)
  if (fields === null) return null
  const type = fields.get('type')
  if (type === 'phase') return toPhaseEvent(fields)
  if (type === 'output' || type === 'audit') {
    const line = fields.get('line')
    return typeof line === 'string' ? { type, line } : null
  }
  if (type === 'console') {
    const level = oneOf(CONSOLE_LEVELS, fields.get('level'))
    const message = fields.get('message')
    return level !== undefined && typeof message === 'string' ? { type, level, message } : null
  }
  return null
}

function unknownOutcome(): RuntimeProvisioningOutcome {
  return { kind: 'unknown' }
}

function toOutcomeWithOperation(fields: Fields, kind: 'connected-ready' | 'not-started'): RuntimeProvisioningOutcome {
  const operation = oneOf(OUTCOME_OPERATIONS, fields.get('operation'))
  if (operation === undefined) return unknownOutcome()
  if (kind === 'connected-ready') return { kind, operation }
  const lastLines = fields.get('lastLines')
  return isStringArray(lastLines) ? { kind, operation, lastLines: [...lastLines] } : unknownOutcome()
}

function toOutcomeWithDetails(fields: Fields, kind: unknown): RuntimeProvisioningOutcome {
  switch (kind) {
    case 'connected-ready':
    case 'not-started':
      return toOutcomeWithOperation(fields, kind)
    case 'invalid-input': {
      const field = oneOf(INVALID_INPUT_FIELDS, fields.get('field'))
      return field === undefined ? unknownOutcome() : { kind, field }
    }
    case 'host-key-changed': {
      const target = fields.get('target')
      return typeof target === 'string' ? { kind, target } : unknownOutcome()
    }
    case 'unsupported': {
      const reason = oneOf(UNSUPPORTED_REASONS, fields.get('reason'))
      const detail = fields.get('detail')
      return reason !== undefined && typeof detail === 'string' ? { kind, reason, detail } : unknownOutcome()
    }
    case 'download-failed': {
      const dockerPresent = fields.get('dockerPresent')
      return typeof dockerPresent === 'boolean' ? { kind, dockerPresent } : unknownOutcome()
    }
    case 'installer-failed':
    case 'start-failed': {
      const lastLines = fields.get('lastLines')
      return isStringArray(lastLines) ? { kind, lastLines: [...lastLines] } : unknownOutcome()
    }
    default:
      return unknownOutcome()
  }
}

const OUTCOMES_WITHOUT_DETAILS: readonly (
  | 'cancelled'
  | 'unknown'
  | 'busy'
  | 'ssh-unreachable'
  | 'host-key-file-unusable'
  | 'host-key-not-saved'
  | 'auth-rejected'
  | 'password-auth-not-accepted'
  | 'no-admin-rights'
  | 'v3-present'
)[] = [
  'cancelled',
  'unknown',
  'busy',
  'ssh-unreachable',
  'host-key-file-unusable',
  'host-key-not-saved',
  'auth-rejected',
  'password-auth-not-accepted',
  'no-admin-rights',
  'v3-present',
]

export function toRuntimeProvisioningOutcome(value: unknown): RuntimeProvisioningOutcome {
  const fields = fieldsOf(value)
  if (fields === null) return unknownOutcome()
  const kind = fields.get('kind')
  const kindWithoutDetails = oneOf(OUTCOMES_WITHOUT_DETAILS, kind)
  if (kindWithoutDetails !== undefined) return { kind: kindWithoutDetails }
  return toOutcomeWithDetails(fields, kind)
}

export function toSshProbeResult(value: unknown): SshProbeResult {
  const unreachable: SshProbeResult = { answered: false, reason: 'unreachable' }
  const fields = fieldsOf(value)
  if (fields === null) return unreachable
  const answered = fields.get('answered')
  if (answered === true) return { answered: true }
  if (answered !== false) return unreachable
  const reason = oneOf(PROBE_FAILURE_REASONS, fields.get('reason'))
  return reason === undefined ? unreachable : { answered: false, reason }
}

export function formatProvisioningTarget(host: string, port: number): string {
  return host.includes(':') ? `[${host}]:${port}` : `${host}:${port}`
}
