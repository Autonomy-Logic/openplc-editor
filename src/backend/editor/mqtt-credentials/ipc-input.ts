import { z } from 'zod'

import { MQTT_CREDENTIAL_LIMITS } from '../../../frontend/utils/mqtt/credentials/validate'
import type {
  MqttCredentialBinding,
  MqttCredentialInputErrorCode,
  MqttCredentialPersistence,
  MqttCredentialPresence,
  MqttCredentialScope,
  MqttCredentialSecret,
} from '../../../middleware/shared/ports/mqtt-credential-port'

export const MQTT_CREDENTIAL_SCOPE_LIMITS = {
  maxProjectKeyChars: 4096,
  maxTargetKeyChars: 512,
  maxServerNameChars: 256,
  maxHostChars: 253,
  maxClientIdChars: 64,
} as const

// Generous ceilings: the byte limits are enforced by `validateMqttCredentialSecret`; these only stop a huge string early.
const MAX_SECRET_FIELD_CHARS = Math.max(
  MQTT_CREDENTIAL_LIMITS.maxCertificateBytes,
  MQTT_CREDENTIAL_LIMITS.maxPrivateKeyBytes,
)

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((char) => {
    const code = char.codePointAt(0) ?? 0
    return code < 0x20 || (code >= 0x7f && code <= 0x9f)
  })

const identifier = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .refine((value) => !hasControlCharacter(value) && value.trim() === value)

export const MqttCredentialScopeInputSchema = z
  .object({
    projectKey: identifier(MQTT_CREDENTIAL_SCOPE_LIMITS.maxProjectKeyChars),
    targetKey: identifier(MQTT_CREDENTIAL_SCOPE_LIMITS.maxTargetKeyChars),
    serverName: identifier(MQTT_CREDENTIAL_SCOPE_LIMITS.maxServerNameChars),
  })
  .strict() satisfies z.ZodType<MqttCredentialScope>

const SecretMethodSchema = z.enum(['username_password', 'client_certificate'])

export const MqttCredentialBindingInputSchema = z
  .object({
    host: z
      .string()
      .max(MQTT_CREDENTIAL_SCOPE_LIMITS.maxHostChars)
      .refine((value) => !hasControlCharacter(value)),
    port: z.number().int().min(1).max(65535),
    tlsEnabled: z.boolean(),
    clientId: z
      .string()
      .max(MQTT_CREDENTIAL_SCOPE_LIMITS.maxClientIdChars)
      .refine((value) => !hasControlCharacter(value)),
    method: SecretMethodSchema,
  })
  .strict() satisfies z.ZodType<MqttCredentialBinding>

const secretText = z.string().max(MAX_SECRET_FIELD_CHARS)

export const MqttCredentialSecretInputSchema = z.discriminatedUnion('method', [
  z.object({ method: z.literal('username_password'), username: secretText, password: secretText }).strict(),
  z
    .object({
      method: z.literal('client_certificate'),
      certificatePem: secretText,
      privateKeyPem: secretText,
      privateKeyPassphrase: secretText.optional(),
    })
    .strict(),
]) satisfies z.ZodType<MqttCredentialSecret>

/** Parses an untrusted IPC argument; never reports what the value was. */
export const parseMqttCredentialScopeInput = (value: unknown): MqttCredentialScope | null => {
  const parsed = MqttCredentialScopeInputSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const parseMqttCredentialBindingInput = (value: unknown): MqttCredentialBinding | null => {
  const parsed = MqttCredentialBindingInputSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

export const parseMqttCredentialSecretInput = (value: unknown): MqttCredentialSecret | null => {
  const parsed = MqttCredentialSecretInputSchema.safeParse(value)
  if (!parsed.success) return null
  const secret = parsed.data
  if (secret.method === 'username_password') return secret
  return secret.privateKeyPassphrase === undefined
    ? { method: secret.method, certificatePem: secret.certificatePem, privateKeyPem: secret.privateKeyPem }
    : secret
}

export type MqttCredentialIpcFailureCode = MqttCredentialInputErrorCode | 'credential_store_unavailable'

export interface MqttCredentialIpcFailure {
  ok: false
  code: MqttCredentialIpcFailureCode
  message: string
}

export type MqttCredentialPresenceReply =
  | { ok: true; persistence: MqttCredentialPersistence; presence: MqttCredentialPresence }
  | MqttCredentialIpcFailure

export type MqttCredentialPutReply =
  | { ok: true; persistence: MqttCredentialPersistence; presence: MqttCredentialPresence }
  | (MqttCredentialIpcFailure & { persistence?: MqttCredentialPersistence })

export type MqttCredentialRemoveReply = { ok: true; persistence: MqttCredentialPersistence } | MqttCredentialIpcFailure

export const MQTT_CREDENTIAL_BAD_REQUEST: MqttCredentialIpcFailure = {
  ok: false,
  code: 'credential_invalid_format',
  message: 'The credential request is malformed.',
}

export const MQTT_CREDENTIAL_STORE_FAILURE: MqttCredentialIpcFailure = {
  ok: false,
  code: 'credential_store_unavailable',
  message: 'The local credential store could not be used.',
}
