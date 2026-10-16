import {
  parseScreenActions,
  type PluginCommandOutcome,
  type VppPluginCommandAction,
  type VppScreenAction,
} from '@root/backend/shared/utils/vpp/screen-actions'
import { Modal, ModalContent, ModalTitle } from '@root/frontend/components/_molecules/modal'
import { useRuntime } from '@root/middleware/shared/providers/platform-context'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Device-facing VPP screen actions — `discover`, `test`, `status`.
 *
 * They ride the runtime's existing `POST /api/plugin-command` catch-all
 * through whatever transport the platform already uses to reach the device.
 * The runtime is not changed by any of this.
 *
 * Three behaviours are what make this usable rather than merely wired:
 *
 *   - A result belongs to the request that produced it. Each run takes a
 *     ticket and a late answer to a superseded request is dropped, so
 *     switching devices or re-running never shows the previous device's
 *     modules as if they were this one's.
 *   - A command in flight cannot be started again, and it always ends — the
 *     adapter bounds it with a timeout — so the panel cannot hang.
 *   - An error is an error even at HTTP 200: that route reports plugin
 *     failures in the body, and `interpretPluginCommandResponse` is what
 *     decides, not the status code.
 */

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : 'The command failed.'
}

type ActionState = { status: 'idle' } | { status: 'running' } | { status: 'done'; outcome: PluginCommandOutcome }

export interface VppScreenActionsProps {
  /** Raw `actions` from the screen section. */
  actions: unknown
  /** Plugin name from the generated config, used when an action omits one. */
  defaultPlugin?: string
  /** Renderer for a local action; the layout owns what those mean. */
  renderLocalAction?: (action: Extract<VppScreenAction, { kind: 'local' }>) => React.ReactNode
  /** Identity of the device the results belong to; a change clears them. */
  deviceKey?: string
  /** Whether a device is connected; actions declaring `requiresConnection` are disabled while false. */
  connected?: boolean
  /**
   * Takes over the successful answer of an action that declares a `resultMapping`.
   * Returns an error message to show, or null when it handled the answer. Without
   * it, such actions are not rendered.
   */
  onMappedResult?: (action: VppPluginCommandAction, data: Record<string, unknown>) => string | null
  /** Actions with a `resultMapping` render only when true (the device can report its modules). */
  discoverySupported?: boolean
}

function VppScreenActions({
  actions,
  defaultPlugin,
  renderLocalAction,
  deviceKey,
  connected = false,
  onMappedResult,
  discoverySupported = false,
}: VppScreenActionsProps) {
  const runtime = useRuntime()
  const parsed = parseScreenActions(actions, defaultPlugin).filter((action) => {
    if (action.kind !== 'plugin-command') return true
    if (action.resultMapping && (!discoverySupported || !onMappedResult)) return false
    return true
  })
  const [state, setState] = useState<Record<string, ActionState>>({})
  // Monotonic ticket per action; only the newest run may publish a result.
  const tickets = useRef<Record<string, number>>({})
  // Action whose `confirm` prompt is open; nothing is sent until the user accepts it.
  const [pendingConfirm, setPendingConfirm] = useState<VppPluginCommandAction | null>(null)

  // A result describes one device. When the target changes, the previous
  // device's answers are not "stale data to refresh" — they are wrong, and
  // showing them next to a new device is worse than showing nothing.
  useEffect(() => {
    setState({})
    // Bump rather than reset, so a run started on the new device never reuses a pending run's ticket.
    for (const id of Object.keys(tickets.current)) tickets.current[id] += 1
    setPendingConfirm(null)
  }, [deviceKey])

  const run = useCallback(
    async (action: VppPluginCommandAction) => {
      if (state[action.id]?.status === 'running') return
      if (action.requiresConnection && !connected) return
      if (!runtime.sendPluginCommand) {
        setState((current) => ({
          ...current,
          [action.id]: {
            status: 'done',
            outcome: { ok: false, error: 'This platform cannot send commands to the device.' },
          },
        }))
        return
      }

      const ticket = (tickets.current[action.id] ?? 0) + 1
      tickets.current[action.id] = ticket
      setState((current) => ({ ...current, [action.id]: { status: 'running' } }))

      let outcome: PluginCommandOutcome
      try {
        outcome = await runtime.sendPluginCommand({
          plugin: action.plugin,
          command: action.command,
          params: action.params,
        })
      } catch (err) {
        outcome = { ok: false, error: errorMessage(err) }
      }

      if (tickets.current[action.id] !== ticket) return
      if (outcome.ok && action.resultMapping && onMappedResult) {
        let error: string | null
        try {
          error = onMappedResult(action, outcome.data)
        } catch (err) {
          error = errorMessage(err)
        }
        setState((current) => ({
          ...current,
          [action.id]: error === null ? { status: 'idle' } : { status: 'done', outcome: { ok: false, error } },
        }))
        return
      }
      setState((current) => ({ ...current, [action.id]: { status: 'done', outcome } }))
    },
    [runtime, state, onMappedResult, connected],
  )

  // A mapped action asks after the answer arrives (the layout's own dialog), so only the others ask first.
  const handleClick = (action: VppPluginCommandAction) => {
    if (action.confirm && !action.resultMapping) {
      setPendingConfirm(action)
      return
    }
    void run(action)
  }

  if (parsed.length === 0) return null

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap gap-2'>
        {parsed.map((action) => {
          if (action.kind === 'local') return renderLocalAction?.(action) ?? null
          const current = state[action.id] ?? { status: 'idle' }
          const needsConnection = action.requiresConnection === true && !connected
          return (
            <button
              key={action.id}
              type='button'
              onClick={() => handleClick(action)}
              disabled={current.status === 'running' || needsConnection}
              title={needsConnection ? 'Connect to a device to use this action.' : undefined}
              className='cursor-pointer rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-700 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800'
            >
              {current.status === 'running' ? `${action.label}…` : action.label}
            </button>
          )
        })}
      </div>
      {parsed.map((action) => {
        if (action.kind !== 'plugin-command') return null
        const current = state[action.id]
        if (!current || current.status !== 'done') return null
        return (
          <div
            key={`${action.id}-result`}
            data-testid={`vpp-action-result-${action.id}`}
            className={
              current.outcome.ok
                ? 'rounded-md border border-neutral-200 p-2 text-xs text-neutral-700 dark:border-neutral-700 dark:text-neutral-300'
                : 'rounded-md border border-red-300 p-2 text-xs text-red-700 dark:border-red-800 dark:text-red-300'
            }
          >
            {current.outcome.ok ? (
              <pre className='max-h-40 overflow-auto whitespace-pre-wrap break-words'>
                {JSON.stringify(current.outcome.data, null, 2)}
              </pre>
            ) : (
              <span>{current.outcome.error}</span>
            )}
          </div>
        )
      })}
      <Modal open={pendingConfirm !== null} onOpenChange={(open) => !open && setPendingConfirm(null)}>
        <ModalContent className='flex w-[420px] select-none flex-col items-center justify-evenly gap-5 rounded-lg p-6'>
          <ModalTitle className='text-center font-caption text-base font-semibold text-neutral-950 dark:text-white'>
            {pendingConfirm?.label}
          </ModalTitle>
          <p className='text-center text-sm text-neutral-600 dark:text-neutral-300'>{pendingConfirm?.confirm}</p>
          <div className='flex w-full flex-col gap-2'>
            <button
              type='button'
              onClick={() => {
                const action = pendingConfirm
                setPendingConfirm(null)
                if (action) void run(action)
              }}
              className='w-full rounded-lg bg-brand px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-medium-dark'
            >
              Continue
            </button>
            <button
              type='button'
              onClick={() => setPendingConfirm(null)}
              className='w-full rounded-lg bg-neutral-100 px-4 py-2 text-center text-sm font-medium text-neutral-1000 hover:bg-neutral-200 dark:bg-neutral-850 dark:text-neutral-100 dark:hover:bg-neutral-800'
            >
              Cancel
            </button>
          </div>
        </ModalContent>
      </Modal>
    </div>
  )
}

export { VppScreenActions }
