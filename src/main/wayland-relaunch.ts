import { spawn } from 'node:child_process'

import { app } from 'electron'

/** Chromium switch that selects native Wayland in a Wayland session and X11 otherwise. */
export const WAYLAND_HINT_SWITCH = '--ozone-platform-hint=auto'

/**
 * Arguments for relaunching the packaged Linux GUI with the Wayland hint, or `null` when no relaunch is needed.
 *
 * Chromium picks its display backend before any script runs, so the hint must be on the command line.
 * An Ozone switch or `ELECTRON_OZONE_PLATFORM_HINT` given by the user is kept as is, and the relaunched
 * process carries the switch, so it never relaunches again.
 */
export function waylandRelaunchArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform,
  isPackaged: boolean,
): string[] | null {
  if (platform !== 'linux' || !isPackaged) return null
  if (!env.WAYLAND_DISPLAY) return null
  if (env.ELECTRON_OZONE_PLATFORM_HINT) return null
  if (argv.some((arg) => arg.startsWith('--ozone-platform'))) return null
  return [WAYLAND_HINT_SWITCH, ...argv.slice(1)]
}

/**
 * Starts the GUI in a child process with `args` and mirrors its lifetime: signals are forwarded and the
 * child's exit code becomes this process's. The parent stays alive because an AppImage unmounts when it exits.
 * Calls `fallback` to run the GUI in this process when the child cannot be started.
 */
export function relaunchWithWaylandHint(args: readonly string[], fallback: () => void): void {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: process.env })

  const forward = (signal: NodeJS.Signals) => () => {
    child.kill(signal)
  }
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, forward(signal))

  child.once('error', fallback)
  child.once('exit', (code) => app.exit(code ?? 1))
}
