/**
 * The contract for actions a VPP screen may declare.
 *
 * Until now the only action either IDE dispatched was the local
 * `clear-module-slots`; a vendor screen could declare anything else and it was
 * silently ignored. Phase 3 adds the device-facing half — `discover`, `test`,
 * `status` — which reach the board's plugin through the runtime's existing
 * `POST /api/plugin-command` catch-all. Nothing is added to the runtime.
 *
 * Both halves parse through the same allowlist here, so an action a screen
 * declares is either one of these shapes or it is not rendered at all: an
 * unrecognised action must not become a button that does nothing, and it must
 * never become a command sent to a device.
 */

/** Local actions the editor handles itself, without touching the device. */
const LOCAL_ACTIONS = new Set(['clear-module-slots'])

/**
 * Plugin commands a screen may invoke. Deliberately a closed set: the runtime
 * forwards whatever it is given to the plugin, so the screen definition is the
 * only place this can be bounded.
 */
const PLUGIN_COMMANDS = new Set(['discover', 'discover_modules', 'test', 'status'])

/** How long a command may run before the UI stops waiting for it. */
export const PLUGIN_COMMAND_TIMEOUT_MS = 15_000

export interface VppLocalAction {
  kind: 'local'
  id: string
  label: string
  action: string
  /** Confirmation prompt text; absent means act immediately. */
  confirm?: string
}

export interface VppPluginCommandAction {
  kind: 'plugin-command'
  id: string
  label: string
  /** Plugin name the runtime routes to — the screen's own `plugin` or the config's. */
  plugin: string
  command: string
  params: Record<string, unknown>
  confirm?: string
}

export type VppScreenAction = VppLocalAction | VppPluginCommandAction

/**
 * Narrow a screen's raw `actions` array into the ones this editor will render.
 * Anything malformed or unrecognised is dropped rather than rendered.
 */
export function parseScreenActions(raw: unknown, defaultPlugin?: string): VppScreenAction[] {
  if (!Array.isArray(raw)) return []

  const actions: VppScreenAction[] = []
  const seen = new Set<string>()
  for (const candidate of raw) {
    if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const entry = candidate as Record<string, unknown>
    const id = entry.id
    const label = entry.label
    if (typeof id !== 'string' || id.length === 0 || typeof label !== 'string' || label.length === 0) continue
    // A duplicate id would give two buttons the same React key and the same
    // identity in the result map.
    if (seen.has(id)) continue
    const confirm = typeof entry.confirm === 'string' ? entry.confirm : undefined

    if (entry.type === 'local') {
      const action = entry.action
      if (typeof action !== 'string' || !LOCAL_ACTIONS.has(action)) continue
      seen.add(id)
      actions.push({ kind: 'local', id, label, action, ...(confirm !== undefined && { confirm }) })
      continue
    }

    if (entry.type === 'plugin-command') {
      const command = entry.command
      if (typeof command !== 'string' || !PLUGIN_COMMANDS.has(command)) continue
      const plugin = typeof entry.plugin === 'string' ? entry.plugin : defaultPlugin
      if (!plugin) continue
      const params =
        entry.params !== null && typeof entry.params === 'object' && !Array.isArray(entry.params)
          ? sanitizeParams(entry.params as Record<string, unknown>)
          : {}
      seen.add(id)
      actions.push({
        kind: 'plugin-command',
        id,
        label,
        plugin,
        command,
        params,
        ...(confirm !== undefined && { confirm }),
      })
    }
  }
  return actions
}

/** Prototype keys would reach the request body's prototype rather than the body. */
function sanitizeParams(params: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(params)) {
    if (key === '__proto__' || key === 'prototype' || key === 'constructor') continue
    out[key] = params[key]
  }
  return out
}

export type PluginCommandOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; error: string }

/**
 * Read `POST /api/plugin-command`'s answer.
 *
 * The route answers HTTP 200 even when the plugin failed, with the failure in
 * an `error` key — treating 200 as success is the mistake this function exists
 * to prevent. A non-200, an unparseable body, or a body that is not an object
 * are all failures too.
 */
export function interpretPluginCommandResponse(statusCode: number, body: unknown): PluginCommandOutcome {
  if (statusCode !== 200) {
    return { ok: false, error: `The device answered ${statusCode}.` }
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'The device returned an unreadable response.' }
  }
  const record = body as Record<string, unknown>
  const error = record.error
  if (typeof error === 'string' && error.length > 0) {
    return { ok: false, error }
  }
  if (error !== undefined && error !== null) {
    return { ok: false, error: 'The plugin reported an error.' }
  }
  return { ok: true, data: record }
}
