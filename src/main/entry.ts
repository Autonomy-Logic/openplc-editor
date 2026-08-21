/**
 * The application entry point, which decides what this process is.
 *
 * A packaged Electron app always runs `package.json.main`; you cannot ask its
 * binary to execute a different script. Without a dispatcher here, the headless
 * CLI would be unreachable from a packaged build — `cli.js` would sit inside
 * `app.asar` with nothing able to start it — and the debug daemon's respawn
 * would silently launch the GUI instead, which is exactly the failure this
 * guard prevents (a window opening in the middle of a headless test run).
 *
 * So both roles ship in one binary and the argv decides:
 *
 *     OpenPLC Editor.app/Contents/MacOS/OpenPLC\ Editor --cli devices
 *     OpenPLC Editor.app/Contents/MacOS/OpenPLC\ Editor --cli-daemon   (internal)
 *
 * The GUI module is imported ONLY when this is not a CLI run. Both modules do
 * their work on import (windows, menus, handlers on one side; argv parsing and
 * command dispatch on the other), so importing both would start both.
 */

import { spawnSync } from 'node:child_process'

/**
 * Is this process a CLI invocation?
 *
 * `--cli-daemon` is the debug session daemon re-entering itself; `--cli` is a
 * user command. Matched on exact tokens rather than a prefix, so a project path
 * that happens to contain "--cli" cannot turn a GUI launch into a CLI one.
 */
export function isCliInvocation(argv: readonly string[]): boolean {
  return argv.includes('--cli') || argv.includes('--cli-daemon')
}

/**
 * Chromium switches a Linux CLI run cannot start without.
 *
 * Kept in step with `platformSwitches` in `backend/editor/cli-shim/shim-plan`,
 * which puts the same list in the generated shim.
 */
const LINUX_CLI_SWITCHES = ['--no-sandbox', '--ozone-platform=headless', '--disable-gpu']

/**
 * Re-exec ourselves with the switches Linux needs, when they are missing.
 *
 * They cannot be applied from JavaScript: Chromium reads them while starting up,
 * so `app.commandLine.appendSwitch` is too late. Re-exec is early enough for
 * SOME of them and not others, and the distinction matters:
 *
 *   - `--ozone-platform=headless` **is** fixed here. Electron initialises its
 *     display layer after this script runs, so without a DISPLAY (an SSH
 *     session, a CI runner) the relaunch is what makes a direct `--cli` call
 *     work at all. Verified: a container with no DISPLAY runs the CLI fine.
 *   - `--no-sandbox` is **not** fixable here. Chromium's SUID sandbox check
 *     happens before any JS runs, so a launch that fails it has already aborted.
 *     In practice this only bites where unprivileged user namespaces are
 *     unavailable — Docker's default seccomp profile, notably — because with
 *     them Chromium uses the namespace sandbox and needs no helper. Those
 *     callers pass `--no-sandbox` once, for the install; the generated shim
 *     carries it from then on.
 *
 * Synchronous and stdio-inherited, so the child's output IS this process's
 * output and its exit code becomes ours — a caller cannot tell a relaunch
 * happened. Guarded on the switches already being present, so it cannot recurse.
 */
function relaunchForLinuxCli(): boolean {
  if (process.platform !== 'linux') return false
  if (LINUX_CLI_SWITCHES.every((flag) => process.argv.includes(flag))) return false

  const result = spawnSync(process.execPath, [...LINUX_CLI_SWITCHES, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: process.env,
  })
  process.exit(result.status ?? 1)
}

if (isCliInvocation(process.argv)) {
  if (!relaunchForLinuxCli()) void import('../cli/main')
} else {
  void import('./main')
}
