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

if (isCliInvocation(process.argv)) {
  void import('../cli/main')
} else {
  void import('./main')
}
