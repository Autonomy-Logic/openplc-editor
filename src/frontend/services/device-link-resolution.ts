/**
 * Turning a board's declarative `debug` spec into something connectable, with the
 * dialogs that sometimes takes.
 *
 * Two flows need this and they used to share nothing:
 *
 *   - Connect (and the reconnect after an upload) needs the ORDERED CANDIDATES for
 *     the device link — Modbus TCP when the project enables it, serial otherwise.
 *   - The debugger needs ONE channel for a session (or, for a runtime target, its
 *     WebSocket).
 *
 * What they have in common is the interactive part: a spec can ask for input (the
 * DHCP address) or offer a choice, which means resolve → ask → resolve again. That
 * loop lives here once. When only Connect had it, Connect could not ask for a DHCP
 * address at all; when only the debugger had it, Connect silently mis-resolved.
 *
 * Deliberately not a hook: it is called from click handlers, keeps no React state,
 * and the modal helpers below reach the store directly — so the same functions
 * serve the activity bar and the device screen without either owning the other.
 */
import {
  type DebugResolverContext,
  type DebugSpec,
  type DeviceLinkCandidateConfig,
  resolveDebugConnection,
  resolveDeviceLinkCandidates,
} from '../../backend/shared/hardware/debug-spec'
import type { DebugConnectionConfig } from '../../middleware/shared/ports/types'
import { useOpenPLCStore } from '../store'

/**
 * Answers the user has already given, keyed by board then by the spec's
 * `cacheKey`. Scoped per board so two devices sharing a cache key (`lastDhcpIp`)
 * do not inherit each other's address. Module-level: it should outlive any one
 * screen, since the same answer serves Connect and the debugger.
 */
const promptCache: Record<string, Record<string, string>> = {}

/** Discard cached answers for a board — used when an entered value stops working. */
export function forgetPromptAnswers(boardTarget: string): void {
  delete promptCache[boardTarget]
}

/**
 * The editor's device dialogs, in one place. Exported because the flows that
 * surround resolution — the debug gate, the switch warning, upload prompts — need
 * to speak in the same voice, and a second copy of this two-line promise wrapper
 * is how two callers end up with subtly different buttons.
 */
export const showDeviceDialog = (
  type: 'info' | 'warning' | 'error' | 'question',
  title: string,
  message: string,
  buttons: string[],
  /** Which button is the primary, and which one Escape / click-away chooses. */
  options?: { primaryButtonIndex?: number; dismissButtonIndex?: number },
): Promise<number> =>
  new Promise((resolve) => {
    useOpenPLCStore.getState().modalActions.openModal('debugger-message', {
      type,
      title,
      message,
      buttons,
      ...options,
      onResponse: (buttonIndex: number) => resolve(buttonIndex),
    })
  })

export const showDeviceInput = (title: string, message: string, defaultValue: string): Promise<string | null> =>
  new Promise((resolve) => {
    useOpenPLCStore.getState().modalActions.openModal('debugger-ip-input', {
      title,
      message,
      defaultValue,
      onSubmit: (value: string) => resolve(value),
      onCancel: () => resolve(null),
    })
  })

/**
 * Build resolver context from current store state on every call, so the user's
 * freshest screen edits count without saving first. `boardTarget` selects the
 * prompt-cache bucket.
 *
 * `runtimeReadyForDebug` is passed in rather than read here: it comes from the
 * runtime port, which only a component can reach, and it is meaningless for the
 * baremetal flows.
 */
export function buildDeviceResolverContext(
  boardTarget: string,
  options: { runtimeReadyForDebug?: boolean } = {},
): DebugResolverContext {
  const store = useOpenPLCStore.getState()
  const cfg = store.deviceDefinitions.configuration
  const runtimeConnection = store.runtimeConnection
  // `vendorScreenData` is already keyed by section id (`modbus_rtu`), which is
  // the resolver's `screens` shape 1:1.
  const screens = (cfg.vendorScreenData ?? {}) as Record<string, Record<string, unknown>>

  return {
    state: {
      configuration: {
        deviceBoard: cfg.deviceBoard,
        ...(cfg.communicationPort ? { communicationPort: cfg.communicationPort } : {}),
        ...(cfg.runtimeIpAddress ? { runtimeIpAddress: cfg.runtimeIpAddress } : {}),
      },
      screens,
      runtimeConnection: {
        ...(runtimeConnection.connectionStatus ? { connectionStatus: runtimeConnection.connectionStatus } : {}),
        ...(runtimeConnection.jwtToken ? { jwtToken: runtimeConnection.jwtToken } : {}),
      },
      promptCache: promptCache[boardTarget] ?? {},
    },
    capabilities: {
      runtimeConnected: options.runtimeReadyForDebug === true && runtimeConnection.connectionStatus === 'connected',
      jwtToken: Boolean(runtimeConnection.jwtToken),
    },
  }
}

/** Outcomes both resolvers can return besides their own success shape. */
type InteractiveOutcome =
  | { kind: 'pick'; channels: Array<{ index: number; label: string }>; title: string; body: string }
  | {
      kind: 'prompt'
      fields: Array<{ field: string; title: string; message: string; cacheKey?: string; defaultValue?: string }>
      channelIndex: number
    }
  | { kind: 'error'; title: string; body: string }
  | { kind: 'unsupported' }

/** What the caller should do next after a non-success outcome. */
type NextStep =
  /** Resolve again; `channelIndex` is the user's pick, if they made one. */
  | { retry: true; channelIndex?: number }
  /** Stop: the user cancelled, or there is nothing to connect to. */
  | { retry: false }

/**
 * Surface whatever the resolver asked for, and say whether to resolve again.
 *
 * A cancelled prompt or picker stops the flow — the user said no, so no dialog is
 * repeated and nothing is guessed on their behalf.
 */
async function handleInteractiveOutcome(outcome: InteractiveOutcome, boardTarget: string): Promise<NextStep> {
  if (outcome.kind === 'error') {
    await showDeviceDialog('warning', outcome.title, outcome.body, ['OK'])
    return { retry: false }
  }
  if (outcome.kind === 'unsupported') return { retry: false }

  if (outcome.kind === 'pick') {
    const choice = await showDeviceDialog(
      'question',
      outcome.title,
      outcome.body,
      outcome.channels.map((channel) => channel.label),
    )
    if (choice < 0 || choice >= outcome.channels.length) return { retry: false }
    return { retry: true, channelIndex: outcome.channels[choice].index }
  }

  // prompt: collect every field, caching answers the spec asked to remember.
  const bucket = (promptCache[boardTarget] ??= {})
  for (const field of outcome.fields) {
    const previous = field.cacheKey ? bucket[field.cacheKey] : undefined
    const answer = await showDeviceInput(field.title, field.message, previous ?? field.defaultValue ?? '')
    if (answer === null) return { retry: false }
    const trimmed = answer.trim()
    if (!trimmed) return { retry: false }
    if (field.cacheKey) bucket[field.cacheKey] = trimmed
  }
  return { retry: true, channelIndex: outcome.channelIndex }
}

/** Guard against a malformed spec bouncing between prompts forever. */
const MAX_RESOLVE_ROUNDS = 8

/**
 * Resolve the ordered ways to reach a baremetal device, asking for input when the
 * spec needs it (the DHCP address).
 *
 * Returns the candidates in the order they should be tried, or null if the user
 * cancelled or the board declares nothing connectable.
 */
export async function resolveDeviceLinkWithUx(
  boardTarget: string,
  spec: DebugSpec | undefined,
  options: { runtimeReadyForDebug?: boolean } = {},
): Promise<DeviceLinkCandidateConfig[] | null> {
  if (!spec) {
    await showDeviceDialog(
      'warning',
      'Cannot Connect',
      'This board has not declared a debug spec, so the editor has no way to reach it. The VPP package must provide a `debug` block.',
      ['OK'],
    )
    return null
  }

  for (let round = 0; round < MAX_RESOLVE_ROUNDS; round += 1) {
    const outcome = resolveDeviceLinkCandidates(spec, buildDeviceResolverContext(boardTarget, options))
    if (outcome.kind === 'candidates') return outcome.candidates

    const next = await handleInteractiveOutcome(outcome, boardTarget)
    if (!next.retry) {
      // A cancelled prompt only rules out the channel that asked. Serial does not
      // prompt, so falling through gives the user the cable instead of nothing —
      // which is the point of having candidates at all.
      if (outcome.kind === 'prompt') {
        const withoutPrompted = resolveDeviceLinkCandidates(spec, buildDeviceResolverContext(boardTarget, options), {
          skipChannels: [outcome.channelIndex],
        })
        if (withoutPrompted.kind === 'candidates') return withoutPrompted.candidates
      }
      return null
    }
  }
  return null
}

/**
 * Resolve the ONE channel a debug session should use, asking for input or a choice
 * when the spec needs it. This is the runtime/simulator path; a baremetal Modbus
 * session rides the device link and needs no channel of its own.
 */
export async function resolveDebugConfigWithUx(
  boardTarget: string,
  spec: DebugSpec | undefined,
  options: { runtimeReadyForDebug?: boolean } = {},
): Promise<DebugConnectionConfig | null> {
  if (!spec) {
    await showDeviceDialog(
      'warning',
      'Debugging Not Available',
      "This board hasn't declared a debug spec.  The VPP package (or hals.json entry) must provide a `debug` block.",
      ['OK'],
    )
    return null
  }

  let channelIndex: number | undefined
  for (let round = 0; round < MAX_RESOLVE_ROUNDS; round += 1) {
    const outcome = resolveDebugConnection(spec, buildDeviceResolverContext(boardTarget, options), channelIndex)
    if (outcome.kind === 'config') return outcome.config

    const next = await handleInteractiveOutcome(outcome, boardTarget)
    if (!next.retry) return null
    channelIndex = next.channelIndex ?? channelIndex
  }
  return null
}
