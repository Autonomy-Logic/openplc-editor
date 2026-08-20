/**
 * Argument parsing, deliberately hand-rolled and dependency-free.
 *
 * The CLI ships inside the app bundle, so every dependency added here is
 * weight in the packaged build; the grammar it has to cover is small and
 * fixed. What it does need to be is PREDICTABLE for a caller that builds
 * argv programmatically:
 *
 *   - `--flag=value` and `--flag value` are the same thing;
 *   - a flag listed in `booleanFlags` never swallows the next token, so
 *     `--upload-if-needed --target x` cannot silently parse the target as the
 *     flag's value (the bug class that makes scripted invocations mysterious);
 *   - `--no-<flag>` sets `<flag>` false;
 *   - `--` ends flag parsing, everything after it is positional;
 *   - a repeated flag collects into an array, so `--var a --var b` works
 *     without a separate list syntax.
 */

export interface ParsedArgs {
  /** First non-flag token, e.g. `debug`. */
  command?: string
  /** Second non-flag token when the command takes one, e.g. `open`. */
  subcommand?: string
  /** Remaining positional tokens, in order. */
  positionals: string[]
  /** Flag values. A repeated flag becomes an array; a boolean flag a boolean. */
  flags: Record<string, string | boolean | string[]>
}

export interface ParseOptions {
  /**
   * Flags that are boolean and must NOT consume the following token.
   * Everything else is treated as taking a value.
   */
  booleanFlags?: readonly string[]
  /** Commands whose second positional is a subcommand rather than an argument. */
  commandsWithSubcommands?: readonly string[]
}

function setFlag(flags: ParsedArgs['flags'], name: string, value: string | boolean): void {
  const existing = flags[name]
  if (existing === undefined) {
    flags[name] = value
    return
  }
  // Repeat → collect. Booleans repeat harmlessly and keep the last value.
  if (typeof value === 'boolean') {
    flags[name] = value
    return
  }
  if (Array.isArray(existing)) {
    existing.push(value)
    return
  }
  flags[name] = typeof existing === 'string' ? [existing, value] : [value]
}

export function parseArgs(argv: readonly string[], options: ParseOptions = {}): ParsedArgs {
  const booleanFlags = new Set(options.booleanFlags ?? [])
  const withSubcommands = new Set(options.commandsWithSubcommands ?? [])

  const positionals: string[] = []
  const flags: ParsedArgs['flags'] = {}
  let onlyPositionals = false

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]

    if (onlyPositionals) {
      positionals.push(token)
      continue
    }

    if (token === '--') {
      onlyPositionals = true
      continue
    }

    // `-y` is the one short flag, because the confirmation prompt it answers is
    // the one people type most and `apt -y` set the expectation.
    if (token === '-y') {
      setFlag(flags, 'yes', true)
      continue
    }

    if (!token.startsWith('--')) {
      positionals.push(token)
      continue
    }

    const body = token.slice(2)

    // `--flag=value` — unambiguous, never consumes the next token.
    const eq = body.indexOf('=')
    if (eq !== -1) {
      setFlag(flags, body.slice(0, eq), body.slice(eq + 1))
      continue
    }

    if (body.startsWith('no-')) {
      setFlag(flags, body.slice(3), false)
      continue
    }

    if (booleanFlags.has(body)) {
      setFlag(flags, body, true)
      continue
    }

    const next = argv[i + 1]
    // A flag at the end, or followed by another flag, is a bare boolean rather
    // than an error — `--quiet` should work even if it wasn't declared.
    if (next === undefined || next.startsWith('--')) {
      setFlag(flags, body, true)
      continue
    }

    setFlag(flags, body, next)
    i += 1
  }

  const [command, second, ...rest] = positionals
  const takesSubcommand = command !== undefined && withSubcommands.has(command)

  return {
    command,
    subcommand: takesSubcommand ? second : undefined,
    positionals: takesSubcommand ? rest : positionals.slice(1),
    flags,
  }
}

/** Read a flag that must be a single string. Returns undefined when absent. */
export function stringFlag(args: ParsedArgs, name: string): string | undefined {
  const value = args.flags[name]
  if (typeof value === 'string') return value
  // An array means the caller passed it twice; the last one wins, matching how
  // shells treat repeated options elsewhere.
  if (Array.isArray(value)) return value[value.length - 1]
  return undefined
}

/** Read a flag that may be repeated, always as a list. */
export function listFlag(args: ParsedArgs, name: string): string[] {
  const value = args.flags[name]
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return [...value]
  return []
}

/** Read a boolean flag. A value-bearing form (`--json=false`) is honoured. */
export function boolFlag(args: ParsedArgs, name: string): boolean {
  const value = args.flags[name]
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value !== 'false' && value !== '0'
  return false
}
