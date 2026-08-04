/**
 * Debug-channel resolver — pure function that evaluates a
 * declarative `DebugSpec` (defined in
 * `middleware/shared/ports/debug-spec-types.ts`) against the
 * platform-supplied state and capabilities, returning either a
 * connection-ready `DebugConnectionConfig` or instructions for the
 * caller to surface a picker / prompt / error dialog.
 *
 * The spec types live in the ports layer so `BoardInfo` (which the
 * device store carries) can reference them without crossing the
 * architecture's port → backend boundary.  This file is the only
 * place the spec is interpreted; everything downstream just
 * consumes the returned `DebugConnectionConfig`.
 *
 * Pure: no fs I/O, no globals, no DOM.  Same inputs always produce
 * the same outcome.  Caller (renderer) is responsible for surfacing
 * dialogs and re-invoking after picker / prompt resolution.
 */

import type { DebugCondition, DebugParam, DebugRef, DebugSpec } from '../../../middleware/shared/ports/debug-spec-types'
import type { DebugConnectionConfig } from '../../../middleware/shared/ports/types'
import type { DebuggerTransport } from '../../../middleware/shared/utils/target-capabilities'

// Re-export types so importers have one canonical entry point.  The
// types themselves live in the ports layer (architecture rule); the
// re-export keeps callsite imports tidy.
export type {
  DebugChannelSpec,
  DebugCondition,
  DebugParam,
  DebugPrecondition,
  DebugPrompt,
  DebugRef,
  DebugSpec,
  DebugSpecMessages,
} from '../../../middleware/shared/ports/debug-spec-types'

// ---------------------------------------------------------------------------
// Resolver — context + outcome shapes
// ---------------------------------------------------------------------------

/**
 * State bag the resolver walks via `$ref` paths.  The platform
 * assembles this from its store before calling
 * `resolveDebugConnection`.  Keep the shape flat-ish — every
 * top-level key is a documented entry point for spec authors.
 */
export interface DebugResolverState {
  /** Mirror of `DeviceConfiguration` minus VPP screen data, which lives under `screens`. */
  configuration: {
    deviceBoard: string
    communicationPort?: string
    runtimeIpAddress?: string
    [key: string]: unknown
  }
  /** VPP screen state keyed by section id → field id.  Mirror of
   *  `DeviceConfiguration.vendorScreenData` — the editor passes it
   *  straight through without any unflattening.  Section IDs are
   *  globally unique within a device by VPP convention. */
  screens: Record<string, Record<string, unknown>>
  /** Runtime-connection state.  Only the fields specs may reference
   *  appear here — packages can't reach arbitrary editor internals.
   *  `connectionStatus` is a free-form string so we don't have to
   *  drag the editor's full `ConnectionStatus` union into the shared
   *  zone; the resolver only compares against `'connected'`. */
  runtimeConnection: {
    connectionStatus?: string
    jwtToken?: string | null
  }
  /** Free-form bag for prompt cache lookups, scoped per
   *  package+device by the resolver-engine caller. */
  promptCache?: Record<string, string>
}

export interface DebugResolverCapabilities {
  /** Result of each precondition the platform supports. */
  runtimeConnected: boolean
  jwtToken: boolean
}

export interface DebugResolverContext {
  state: DebugResolverState
  capabilities: DebugResolverCapabilities
}

/**
 * Resolver outcome.  Caller drives UX based on `kind`:
 *
 *  - `config`   → hand straight to `DebuggerPort.connect()`.
 *  - `pick`     → show a picker over `channels[]`; re-call resolver
 *                 with the user's chosen `pickedChannel`.
 *  - `prompt`   → show input modals for `fields`; re-call resolver
 *                 with values folded into `state.promptCache`.
 *  - `error`    → show `title`/`body` dialog and stop.
 *  - `unsupported` → no `DebugSpec` declared on the device entry.
 *                    Caller's choice whether to refuse or fall back.
 */
export type DebugResolverOutcome =
  | { kind: 'config'; config: DebugConnectionConfig; channelLabel: string }
  | { kind: 'pick'; channels: Array<{ index: number; label: string }>; title: string; body: string }
  | {
      kind: 'prompt'
      fields: Array<{
        field: string
        title: string
        message: string
        cacheKey?: string
        defaultValue?: string
      }>
      channelIndex: number
    }
  | { kind: 'error'; title: string; body: string }
  | { kind: 'unsupported' }

/**
 * Which capability transport a declared channel kind belongs to.
 *
 * `simulator` maps to `modbus-serial` because that is what it is: RTU over the
 * emulated serial port the in-process simulator exposes.
 */
const CHANNEL_TRANSPORT: Record<string, DebuggerTransport> = {
  rtu: 'modbus-serial',
  simulator: 'modbus-serial',
  tcp: 'modbus-tcp',
  websocket: 'websocket',
}

/** One resolved way to reach the device, with the channel it came from. */
export interface DeviceLinkCandidateConfig {
  config: DebugConnectionConfig
  channelLabel: string
  /** Index in `spec.channels`, so a caller can skip this channel on a re-resolve. */
  channelIndex: number
}

/**
 * Outcome of resolving link candidates. Shares `prompt` / `error` / `unsupported`
 * with `DebugResolverOutcome` so ONE renderer loop can drive both this and the
 * debugger's single-channel resolution.
 */
export type DeviceLinkCandidatesOutcome =
  | {
      kind: 'candidates'
      candidates: DeviceLinkCandidateConfig[]
      /**
       * Channels that could be tried, but only after asking the user something
       * (a DHCP address). Empty unless the caller passed `deferPrompts`.
       */
      awaitingInput: number[]
    }
  | Extract<DebugResolverOutcome, { kind: 'prompt' } | { kind: 'error' } | { kind: 'unsupported' }>

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

/**
 * Walk `path` into `state`.  Returns `undefined` for missing
 * intermediates rather than throwing — the resolver treats missing
 * fields as "absent" so `default` / `required` can do their job.
 */
function lookupRef(path: string, state: DebugResolverState): unknown {
  const parts = path.split('.')
  let cursor: unknown = state as unknown
  for (const part of parts) {
    if (cursor === null || cursor === undefined || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[part]
  }
  return cursor
}

function evaluateRef(ref: DebugRef, state: DebugResolverState): unknown {
  const raw = lookupRef(ref.$ref, state)
  const resolved = raw === undefined ? ref.default : raw
  if (resolved === undefined) return undefined
  if (ref.as === 'number') {
    const n = typeof resolved === 'number' ? resolved : Number(resolved)
    return Number.isFinite(n) ? n : undefined
  }
  if (ref.as === 'boolean') return Boolean(resolved)
  if (ref.as === 'string') return String(resolved)
  return resolved
}

function evaluateCondition(condition: DebugCondition, state: DebugResolverState): boolean {
  if (typeof condition === 'boolean') return condition
  const value = evaluateRef(condition, state)
  return Boolean(value)
}

function evaluateParam(param: DebugParam, state: DebugResolverState): unknown {
  if (param !== null && typeof param === 'object' && '$ref' in param) {
    return evaluateRef(param, state)
  }
  return param
}

/**
 * Resolve a device's `DebugSpec` against the platform-supplied
 * state + capabilities.  Pure: same inputs always produce the same
 * outcome.  Caller (renderer) is responsible for surfacing dialogs
 * and re-invoking after picker / prompt resolution.
 *
 * `selectedChannelIndex` overrides the auto-select-from-`enabledWhen`
 * logic — used when the renderer's picker UI returns a user choice.
 */
export function resolveDebugConnection(
  spec: DebugSpec | undefined,
  context: DebugResolverContext,
  selectedChannelIndex?: number,
): DebugResolverOutcome {
  if (!spec) return { kind: 'unsupported' }

  // Preconditions gate the whole resolution — fail fast with a
  // clear message before walking channels.
  for (const precondition of spec.preconditions ?? []) {
    if (!context.capabilities[precondition]) {
      if (precondition === 'runtimeConnected') {
        return { kind: 'error', title: 'Connection Required', body: 'Connect to the target runtime first.' }
      }
      if (precondition === 'jwtToken') {
        return {
          kind: 'error',
          title: 'Authentication Required',
          body: 'JWT token missing.  Reconnect to the runtime to refresh credentials.',
        }
      }
    }
  }

  // Pick the active channel: explicit override (from picker), single
  // eligible match, or surface a picker when multiple match.
  let activeIndex: number
  if (selectedChannelIndex !== undefined) {
    activeIndex = selectedChannelIndex
  } else {
    const enabled = spec.channels
      .map((channel, index) => ({ channel, index }))
      .filter(({ channel }) => evaluateCondition(channel.enabledWhen, context.state))
    if (enabled.length === 0) {
      // Always-on debugger: every baremetal firmware keeps the serial debug
      // function codes compiled in even when no Modbus transport is enabled
      // (the DEBUGGER_ENABLED gate brings up the serial port without Modbus
      // operation buffers). So when no channel's `enabledWhen` matches, fall
      // back to the serial (`rtu`) channel instead of erroring — serial debug
      // is always available. A TCP-only Modbus build leaves `enabled` non-empty
      // (the `tcp` channel matches), so it never reaches this fallback and
      // correctly debugs over TCP, matching the firmware which does NOT bring
      // up the serial debugger in that configuration.
      const rtuFallbackIndex = spec.channels.findIndex((channel) => channel.channel === 'rtu')
      if (rtuFallbackIndex < 0) {
        const msg = spec.messages?.noneEnabled
        return {
          kind: 'error',
          title: msg?.title ?? 'No Debug Channel',
          body: msg?.body ?? 'No debug channel is enabled for this board.',
        }
      }
      activeIndex = rtuFallbackIndex
    } else if (enabled.length > 1) {
      const msg = spec.messages?.pickProtocol
      return {
        kind: 'pick',
        channels: enabled.map(({ channel, index }) => ({ index, label: channel.label })),
        title: msg?.title ?? 'Select Debug Channel',
        body: msg?.body ?? 'Multiple debug channels are enabled.  Which one should the debugger use?',
      }
    } else {
      activeIndex = enabled[0].index
    }
  }

  const channel = spec.channels[activeIndex]
  if (!channel) {
    return { kind: 'error', title: 'Internal Error', body: `Invalid channel index ${activeIndex}.` }
  }

  // Surface prompts that haven't been answered yet (cache miss).
  // Prompts gate connection — caller fills them, re-invokes resolver,
  // and resolver returns `config` on the second pass.
  const pendingPrompts: Array<{
    field: string
    title: string
    message: string
    cacheKey?: string
    defaultValue?: string
  }> = []
  for (const prompt of channel.prompts ?? []) {
    if (prompt.when !== undefined && !evaluateCondition(prompt.when, context.state)) continue
    const cachedKey = prompt.cacheKey
    const cached = cachedKey ? context.state.promptCache?.[cachedKey] : undefined
    if (cached) continue
    pendingPrompts.push({
      field: prompt.field,
      title: prompt.title,
      message: prompt.message,
      ...(prompt.cacheKey !== undefined ? { cacheKey: prompt.cacheKey } : {}),
    })
  }
  if (pendingPrompts.length > 0) {
    return { kind: 'prompt', fields: pendingPrompts, channelIndex: activeIndex }
  }

  // Resolve params.  Prompts have already populated promptCache for
  // their fields; channel params reference the cache by `cacheKey`.
  const connectionParams: Record<string, unknown> = {}
  for (const [name, raw] of Object.entries(channel.params)) {
    const resolved = evaluateParam(raw, context.state)
    if (resolved === undefined) {
      // Check for `required` annotation on the ref.
      if (raw !== null && typeof raw === 'object' && '$ref' in raw && raw.required) {
        return { kind: 'error', title: 'Configuration Error', body: raw.required }
      }
      // Otherwise drop the param silently — channel adapter handles undefined.
      continue
    }
    connectionParams[name] = resolved
  }
  // Apply any prompt cache values that target this channel's params.
  for (const prompt of channel.prompts ?? []) {
    const cached = prompt.cacheKey ? context.state.promptCache?.[prompt.cacheKey] : undefined
    if (cached) connectionParams[prompt.field] = cached
  }

  return {
    kind: 'config',
    channelLabel: channel.label,
    config: {
      connectionType: channel.channel,
      connectionParams: connectionParams as DebugConnectionConfig['connectionParams'],
    },
  }
}

/**
 * Resolve the ordered ways to reach a target — ANY target.
 *
 * The caller does not pick a medium; it gets candidates in preference order and the
 * connection manager tries them until one answers. That makes this the single
 * interpreter of a `debug` spec, whatever kind of target declared it:
 *
 *   1. `rtu` — serial. Always a candidate for a board that declares it, regardless
 *      of whether Modbus RTU is enabled, because the always-on debugger keeps the
 *      serial protocol compiled into every baremetal firmware. Preferred because it
 *      is the direct, local, physically unambiguous path: if a cable is attached,
 *      that is the device in front of you, with no address to be stale and nothing
 *      to ask the user.
 *   2. `tcp` — Modbus TCP, when enabled. A baremetal board's remote path, and a
 *      Runtime v3's debug channel.
 *   3. `websocket` — a Runtime v4's debug channel.
 *   4. `simulator` — in-process.
 *
 * In practice the sets are disjoint: a baremetal board declares serial and possibly
 * Modbus TCP, a runtime declares exactly one network channel, the simulator one
 * in-process channel. So the ordering only ever decides anything for a baremetal
 * board — but it is expressed once, for every kind, rather than once per caller.
 * Resolving a runtime's channel through a serial-and-TCP-only version of this
 * function is what left Runtime v4 targets with no session at all.
 *
 * Order is a preference, not a promise: the manager still verifies each candidate
 * before keeping it, so a cable attached to a board with no firmware falls through
 * to the next option rather than stranding the user.
 *
 * A channel needing user input (a DHCP address) is asked for LAST — see
 * `deferPrompts` — so a user with a cable attached is never interrupted by a
 * question about an address they do not need to know.
 *
 * If nothing can be built the caller gets the reason the first candidate failed: an
 * editor reporting "connected" with nothing connected is what makes every later
 * request time out for no visible reason.
 */
export function resolveDeviceLinkCandidates(
  spec: DebugSpec | undefined,
  context: DebugResolverContext,
  options: {
    /**
     * The target's `debuggerTransports`, in preference order, from its capability
     * matrix. Required: which media a target speaks is a fact about the target, and
     * the resolver has no business guessing it.
     */
    transports: DebuggerTransport[]
    /** Channels to leave out — e.g. one the user has declined. */
    skipChannels?: number[]
    /** Consider ONLY these channels. Used for the second pass, after a prompt. */
    onlyChannels?: number[]
    /**
     * Don't ask the user anything: a channel that needs input is left out and
     * reported in `awaitingInput` instead of bubbling up as a `prompt`. Lets a
     * caller try everything that works silently before interrupting anyone.
     */
    deferPrompts?: boolean
  },
): DeviceLinkCandidatesOutcome {
  // `channels` arrives from a VPP manifest, so treat it as possibly absent
  // rather than trusting the type: a malformed package must produce a dialog,
  // not an exception inside a click handler.
  const channels = spec?.channels
  if (!spec || !channels?.length) return { kind: 'unsupported' }

  const transports = options.transports
  const skip = new Set(options.skipChannels ?? [])
  const only = options.onlyChannels ? new Set(options.onlyChannels) : null
  const included = (index: number): boolean => !skip.has(index) && (only === null || only.has(index))

  // Order and eligibility come from the TARGET's declared transports, not from any
  // list kept here: `debuggerTransports` already says which media a target speaks
  // and in what order (`['modbus-serial', 'modbus-tcp']` for an Arduino board,
  // `['websocket']` for a Runtime v4, `['modbus-tcp']` for a v3). Honouring that
  // declaration is what makes one resolver serve every kind of target — and a
  // channel the target cannot actually speak is not a candidate, however the spec
  // describes it.
  const eligible: number[] = []
  for (const transport of transports) {
    channels.forEach((channel, index) => {
      if (!included(index) || CHANNEL_TRANSPORT[channel.channel] !== transport) return
      // Serial is exempt from `enabledWhen`: "Modbus RTU disabled" does not mean the
      // board is unreachable over serial, because the always-on debugger keeps the
      // serial protocol compiled in either way. Every other kind must be turned on.
      if (channel.channel !== 'rtu' && !evaluateCondition(channel.enabledWhen, context.state)) return
      eligible.push(index)
    })
  }

  if (eligible.length === 0) {
    const message = spec.messages?.noneEnabled
    return {
      kind: 'error',
      title: message?.title ?? 'No Connection Channel',
      body: message?.body ?? 'This target declares no channel the editor can connect through.',
    }
  }

  const candidates: DeviceLinkCandidateConfig[] = []
  const awaitingInput: number[] = []
  let firstFailure: Extract<DebugResolverOutcome, { kind: 'error' } | { kind: 'unsupported' }> | null = null

  for (const index of eligible) {
    const outcome = resolveDebugConnection(spec, context, index)
    if (outcome.kind === 'config') {
      candidates.push({ config: outcome.config, channelLabel: outcome.channelLabel, channelIndex: index })
      continue
    }
    if (outcome.kind === 'prompt') {
      if (options.deferPrompts) {
        awaitingInput.push(index)
        continue
      }
      return outcome
    }
    // 'pick' cannot occur: every resolve above names its channel by index.
    if (outcome.kind === 'error' || outcome.kind === 'unsupported') firstFailure ??= outcome
  }

  if (candidates.length === 0 && awaitingInput.length === 0) {
    return firstFailure ?? { kind: 'unsupported' }
  }
  return { kind: 'candidates', candidates, awaitingInput }
}
