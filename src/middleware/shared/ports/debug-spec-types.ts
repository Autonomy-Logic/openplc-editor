/**
 * Debug-channel resolution spec — types only.  Lives in the ports
 * layer so it can be referenced by `BoardInfo` (which the device
 * store carries) without crossing into `backend/shared/`.  The
 * resolver implementation that consumes these types lives at
 * `backend/shared/hardware/debug-spec.ts`.
 *
 * Pattern mirrors how the rest of the manifest declares board
 * behavior: pure data, no code, `$ref` strings point into the
 * runtime state the editor already tracks
 * (`configuration.*`, `screens.<sectionId>.<fieldId>`,
 * `runtimeConnection.*`).  `<sectionId>` is the VPP screen
 * section's `id` field (e.g. `modbus_rtu`) — the same key
 * `DeviceConfiguration.vendorScreenData` is indexed by.
 *
 * Same `DebugSpec` shape sits in both byte-identical `hals.json`
 * entries and per-device VPP manifest entries.
 */

import type { DebugConnectionType } from './types'

/**
 * Closed enum of editor-known preconditions.  Each name maps to a
 * boolean the platform supplies via `DebugResolverContext.capabilities`.
 * Packages reference these by name; the editor decides what each one
 * means on its platform (editor desktop: runtime store; web: same
 * store after the orchestrator handshake).
 *
 * Adding a new precondition is an editor change (new enum value +
 * matching platform shim) — intentionally narrow so packages can't
 * gate on arbitrary platform internals.
 */
export type DebugPrecondition = 'runtimeConnected' | 'jwtToken'

/**
 * `$ref` pointer plus optional defaulting / coercion / validation.
 * Path is a dot-separated walk into the resolver-context state bag
 * (e.g. `configuration.communicationPort`,
 * `screens.modbus_rtu.enabled`,
 * `runtimeConnection.jwtToken`).
 *
 * `default` kicks in when the resolved value is `undefined`.
 * `as` coerces strings to numbers (used for baud rate and slave id
 * — both stored as strings on screens but consumed as numbers by
 * the debugger transport).  `required` produces an error result
 * with the given message when the field is missing after defaults.
 */
export interface DebugRef {
  $ref: string
  default?: string | number | boolean
  as?: 'number' | 'string' | 'boolean'
  required?: string
}

/** Literal boolean or a `$ref` resolving to one — used by `enabledWhen`. */
export type DebugCondition = boolean | DebugRef

/** Channel param value: literal or `$ref`. */
export type DebugParam = string | number | boolean | DebugRef

/**
 * Prompt the editor will surface when its `when` condition resolves
 * truthy AFTER channel params are otherwise resolved.  Result is
 * stored into the channel's params at `field` and (when `cacheKey`
 * is set) cached in renderer-local memory so the user doesn't
 * re-enter the same value every debug session.
 */
export interface DebugPrompt {
  /** Conditional gate.  Omit for unconditional prompts. */
  when?: DebugCondition
  /** Which channel param to populate. */
  field: string
  title: string
  message: string
  /** Optional renderer-local cache key. */
  cacheKey?: string
}

export interface DebugChannelSpec {
  /** Human-readable picker label (shown when multiple channels match). */
  label: string
  /** Which transport `DebuggerPort.connect` will receive. */
  channel: DebugConnectionType
  /** Truthy → channel is eligible.  Multiple eligible → picker. */
  enabledWhen: DebugCondition
  /** Channel params, each literal or `$ref`. */
  params: Record<string, DebugParam>
  /** Optional input prompts surfaced before connecting. */
  prompts?: DebugPrompt[]
}

export interface DebugSpecMessages {
  noneEnabled?: { title: string; body: string }
  pickProtocol?: { title: string; body: string }
}

export interface DebugSpec {
  preconditions?: DebugPrecondition[]
  channels: DebugChannelSpec[]
  messages?: DebugSpecMessages
}
