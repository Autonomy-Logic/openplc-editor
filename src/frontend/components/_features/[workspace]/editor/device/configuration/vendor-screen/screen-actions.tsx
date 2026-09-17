import {
  parseScreenActions,
  type PluginCommandOutcome,
  type VppPluginCommandAction,
  type VppScreenAction,
} from '@root/backend/shared/utils/vpp/screen-actions'
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

type ActionState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; outcome: PluginCommandOutcome }

export interface VppScreenActionsProps {
  /** Raw `actions` from the screen section. */
  actions: unknown
  /** Plugin name from the generated config, used when an action omits one. */
  defaultPlugin?: string
  /** Renderer for a local action; the layout owns what those mean. */
  renderLocalAction?: (action: Extract<VppScreenAction, { kind: 'local' }>) => React.ReactNode
  /** Identity of the device the results belong to; a change clears them. */
  deviceKey?: string
}

function VppScreenActions({ actions, defaultPlugin, renderLocalAction, deviceKey }: VppScreenActionsProps) {
  const runtime = useRuntime()
  const parsed = parseScreenActions(actions, defaultPlugin)
  const [state, setState] = useState<Record<string, ActionState>>({})
  // Monotonic ticket per action; only the newest run may publish a result.
  const tickets = useRef<Record<string, number>>({})

  // A result describes one device. When the target changes, the previous
  // device's answers are not "stale data to refresh" — they are wrong, and
  // showing them next to a new device is worse than showing nothing.
  useEffect(() => {
    setState({})
    tickets.current = {}
  }, [deviceKey])

  const run = useCallback(
    async (action: VppPluginCommandAction) => {
      if (state[action.id]?.status === 'running') return
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

      const outcome = await runtime.sendPluginCommand({
        plugin: action.plugin,
        command: action.command,
        params: action.params,
      })

      if (tickets.current[action.id] !== ticket) return
      setState((current) => ({ ...current, [action.id]: { status: 'done', outcome } }))
    },
    [runtime, state],
  )

  if (parsed.length === 0) return null

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap gap-2'>
        {parsed.map((action) => {
          if (action.kind === 'local') return renderLocalAction?.(action) ?? null
          const current = state[action.id] ?? { status: 'idle' }
          return (
            <button
              key={action.id}
              type='button'
              onClick={() => void run(action)}
              disabled={current.status === 'running'}
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
    </div>
  )
}

export { VppScreenActions }
