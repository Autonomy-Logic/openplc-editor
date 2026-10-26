/**
 * Wire protocol between the host and the relay script that runs next to a vendor
 * configurator bundle inside a sandboxed iframe. The relay ships with the package;
 * the host refuses a relay whose `relayVersion` differs from `RELAY_PROTOCOL_VERSION`.
 *
 * Everything received from the relay is untrusted guest data and is parsed here
 * before the host uses it.
 */

import { z } from 'zod'

export const RELAY_CHANNEL = 'openplc.vendor-document'
export const RELAY_PROTOCOL_VERSION = 1

/** Hex characters; a Device Editor 3.5.22 station archive is around 25,000. */
export const MAX_ARCHIVE_HEX_LENGTH = 16 * 1024 * 1024
export const MAX_DEVICE_SETUP_DEVICES = 256
const MAX_IDENTIFIER_LENGTH = 256

/** The configurator's opaque station archive: non-empty, even-length hex. */
export const configuratorArchiveSchema = z
  .string()
  .max(MAX_ARCHIVE_HEX_LENGTH)
  .regex(/^(?:[0-9a-fA-F]{2})+$/, 'is not hex')

export const deviceReferenceSchema = z.object({
  guid: z.string().max(MAX_IDENTIFIER_LENGTH),
  name: z.string().max(MAX_IDENTIFIER_LENGTH),
  typeId: z.string().max(MAX_IDENTIFIER_LENGTH),
})
export type DeviceReference = z.infer<typeof deviceReferenceSchema>

export const deviceSetupSchema = z.object({
  systembus: deviceReferenceSchema,
  devices: z.array(deviceReferenceSchema).max(MAX_DEVICE_SETUP_DEVICES),
})
export type DeviceSetup = z.infer<typeof deviceSetupSchema>

/**
 * `datatype` is a string: the bundle reports vendor names (`Bitarea`, `UInt8`, ...) beyond its declared IEC union.
 * `min`/`max` are declared by the bundle's API but omitted from what it returns.
 */
export const dataPointSchema = z.object({
  id: z.string(),
  name: z.string(),
  min: z.string().optional(),
  max: z.string().optional(),
  datatype: z.string(),
  byteoffset: z.number(),
  bitoffset: z.number(),
  bitlength: z.number(),
  direction: z.string().optional(),
  access: z.string().optional(),
})
export type DataPoint = z.infer<typeof dataPointSchema>

/** The relay rejects any method not listed here. */
export const RELAY_METHODS = [
  'setController',
  'show',
  'setProject',
  'getConfiguration',
  'getDeviceSetup',
  'getDataPoints',
] as const
export type RelayMethod = (typeof RELAY_METHODS)[number]

export function isRelayMethod(value: unknown): value is RelayMethod {
  return RELAY_METHODS.some((method) => method === value)
}

const hostToRelaySchema = z.discriminatedUnion('kind', [
  z.object({ channel: z.literal(RELAY_CHANNEL), kind: z.literal('hello') }),
  z.object({
    channel: z.literal(RELAY_CHANNEL),
    kind: z.literal('request'),
    id: z.string().min(1),
    method: z.string(),
    args: z.array(z.unknown()),
  }),
])
export type HostToRelayMessage = z.infer<typeof hostToRelaySchema>

const relayToHostSchema = z.discriminatedUnion('kind', [
  z.object({ channel: z.literal(RELAY_CHANNEL), kind: z.literal('ready'), relayVersion: z.number() }),
  z.object({
    channel: z.literal(RELAY_CHANNEL),
    kind: z.literal('response'),
    id: z.string().min(1),
    ok: z.boolean(),
    result: z.unknown().optional(),
    error: z.string().optional(),
  }),
  z.object({ channel: z.literal(RELAY_CHANNEL), kind: z.literal('modified') }),
  z.object({ channel: z.literal(RELAY_CHANNEL), kind: z.literal('error'), message: z.string() }),
])
export type RelayToHostMessage = z.infer<typeof relayToHostSchema>

export function parseHostToRelayMessage(data: unknown): HostToRelayMessage | null {
  const parsed = hostToRelaySchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

export function parseRelayToHostMessage(data: unknown): RelayToHostMessage | null {
  const parsed = relayToHostSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

/** One side of a postMessage link; `subscribe` delivers raw, unvalidated `data`. */
export interface RelayTransport<Outgoing> {
  post(message: Outgoing): void
  subscribe(handler: (data: unknown) => void): () => void
}
