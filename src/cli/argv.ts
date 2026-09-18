/**
 * Separating the CLI's own arguments from the launcher's.
 *
 * Its own module because it is pure and needs testing: importing `main.ts`
 * starts the CLI and reaches for Electron's `app`, so the rule could not be
 * covered where it used to live — and it is a rule with a sharp edge, below.
 */

/**
 * The arguments that are OURS, separated from the launcher's.
 *
 * Everything before the `--cli` marker belongs to Electron: the executable, a
 * script path in development, and the Chromium switches the shim passes
 * (`--no-sandbox`, `--ozone-platform=headless`, …). Slicing at the marker is not
 * tidiness — feeding those switches to this parser actively breaks it. Found in
 * a container: `--disable-gpu` is not a declared boolean flag, so it consumed
 * the following token as its value and `--cli install-cli` arrived as the flag
 * `disable-gpu=install-cli` with no command at all, which printed the usage and
 * looked like a mis-typed command.
 *
 * Without the marker (a development bundle invoked directly) fall back to
 * dropping argv[0] and a leading script path.
 */
export function cliArgv(argv: readonly string[]): string[] {
  const marker = argv.indexOf('--cli')
  if (marker !== -1) return argv.slice(marker + 1)

  const rest = argv.slice(1)
  if (rest.length > 0 && !rest[0].startsWith('-') && looksLikeEntryPath(rest[0])) {
    return rest.slice(1)
  }
  return rest
}

/** A script path Electron was handed, as opposed to the user's first argument. */
function looksLikeEntryPath(value: string): boolean {
  return value.endsWith('.js') || value.endsWith('.ts') || value.endsWith('.asar') || value.includes('/dist/')
}
