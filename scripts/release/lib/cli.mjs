import { parseArgs } from 'node:util'

/** A failed check: each problem is printed on its own line and the process exits with `exitCode`, 1 by default. */
export class CheckFailure extends Error {
  /**
   * @param {string[]} problems
   * @param {number} [exitCode]
   */
  constructor(problems, exitCode = 1) {
    super(problems.join('\n'))
    this.problems = problems
    this.exitCode = exitCode
  }
}

/**
 * Parses the command line strictly and requires every option named in `required`.
 * @param {import('node:util').ParseArgsConfig['options']} options
 * @param {string[]} required
 * @param {string[]} [args]
 * @returns {{ values: Record<string, string | string[] | boolean | undefined>, positionals: string[] }}
 */
export function parseCli(options, required, args = process.argv.slice(2)) {
  let parsed
  try {
    parsed = parseArgs({ args, options, allowPositionals: true, strict: true })
  } catch (error) {
    throw new CheckFailure([error instanceof Error ? error.message : String(error)])
  }
  const missing = required.filter((name) => typeof parsed.values[name] !== 'string' || parsed.values[name] === '')
  if (missing.length > 0) throw new CheckFailure(missing.map((name) => `missing option --${name}`))
  return parsed
}

/** Runs a script body; an error ends the process after printing its message, with a CheckFailure's `exitCode` or 1. */
export function runCli(main) {
  try {
    main()
  } catch (error) {
    const lines =
      error instanceof CheckFailure ? error.problems : [error instanceof Error ? error.message : String(error)]
    for (const line of lines) console.error(line)
    process.exit(error instanceof CheckFailure ? error.exitCode : 1)
  }
}
