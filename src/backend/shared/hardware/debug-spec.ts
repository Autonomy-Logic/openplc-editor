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
      const msg = spec.messages?.noneEnabled
      return {
        kind: 'error',
        title: msg?.title ?? 'No Debug Channel',
        body: msg?.body ?? 'No debug channel is enabled for this board.',
      }
    }
    if (enabled.length > 1) {
      const msg = spec.messages?.pickProtocol
      return {
        kind: 'pick',
        channels: enabled.map(({ channel, index }) => ({ index, label: channel.label })),
        title: msg?.title ?? 'Select Debug Channel',
        body: msg?.body ?? 'Multiple debug channels are enabled.  Which one should the debugger use?',
      }
    }
    activeIndex = enabled[0].index
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
