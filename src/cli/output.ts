/**
 * How the CLI talks back: structured for machines, formatted for people.
 *
 * The mode is chosen from whether stdout is a TTY, not from a flag, because
 * the callers that need JSON are exactly the ones that cannot pass a flag they
 * forgot to pass — a test harness pipes stdout and gets JSON automatically,
 * while a human at a terminal gets a table. `--json` / `--no-json` override it
 * for the cases where the guess is wrong (a human piping into `less`, a CI job
 * with a pty).
 *
 * Three rules the automated callers depend on:
 *
 *   1. In JSON mode, stdout carries EXACTLY ONE json document — the result.
 *      Progress and diagnostics go to stderr. A caller can therefore
 *      `JSON.parse(stdout)` without filtering, which is what stops harnesses
 *      from growing line-matching heuristics.
 *   2. No ANSI, no spinners, no progress bars in JSON mode. A carriage-return
 *      redraw is a human affordance and it corrupts captured output.
 *   3. Errors are objects with a stable `code` (see `ErrorCode`), never bare
 *      prose. The sentence may be reworded; the code may not.
 */

import { ErrorCode, type ErrorCodeValue, ExitCode, type ExitCodeValue } from './exit-codes'

export type OutputMode = 'json' | 'human'

export interface WriterStreams {
  /** Result channel. Exactly one JSON document in JSON mode. */
  out: (text: string) => void
  /** Progress + diagnostics. Never carries the result. */
  err: (text: string) => void
}

export interface ReporterOptions {
  mode: OutputMode
  streams: WriterStreams
  /** Suppress progress lines entirely (`--quiet`). Errors still print. */
  quiet?: boolean
}

/** A failure the caller can branch on without reading English. */
export interface CliFailure {
  code: ErrorCodeValue
  message: string
  /** Optional structured payload — compiler diagnostics, attempted endpoints. */
  details?: unknown
}

export interface CliResult {
  exitCode: ExitCodeValue
}

/**
 * Decide the output mode. An explicit flag always wins; otherwise a TTY means
 * a human is reading.
 */
export function resolveOutputMode(options: { json?: boolean; noJson?: boolean; isTTY: boolean }): OutputMode {
  if (options.json) return 'json'
  if (options.noJson) return 'human'
  return options.isTTY ? 'human' : 'json'
}

export class Reporter {
  private readonly mode: OutputMode
  private readonly streams: WriterStreams
  private readonly quiet: boolean
  /** Guards rule 1: a second result would make stdout unparseable. */
  private resultEmitted = false

  constructor(options: ReporterOptions) {
    this.mode = options.mode
    this.streams = options.streams
    this.quiet = options.quiet ?? false
  }

  get isJson(): boolean {
    return this.mode === 'json'
  }

  /**
   * A progress line. Goes to stderr in BOTH modes — in human mode because
   * that keeps `openplc-cli compile > log` behaving, in JSON mode because stdout
   * is reserved for the single result document.
   */
  progress(message: string): void {
    if (this.quiet) return
    this.streams.err(`${message}\n`)
  }

  /**
   * The command's answer. `payload` is emitted verbatim as JSON in JSON mode;
   * `humanRender` produces the terminal form. Callers pass both so neither
   * mode is an afterthought that renders `[object Object]`.
   */
  success(payload: Record<string, unknown>, humanRender: () => string): CliResult {
    this.emitResult({ ok: true, ...payload }, humanRender)
    return { exitCode: ExitCode.Ok }
  }

  /** A failure, with the exit code the caller should see. */
  failure(failure: CliFailure, exitCode: ExitCodeValue): CliResult {
    this.emitResult({ ok: false, error: failure }, () => `error [${failure.code}]: ${failure.message}`)
    return { exitCode }
  }

  /** An unanticipated throw — a CLI bug, reported as one rather than as usage. */
  internalError(error: unknown): CliResult {
    const message = error instanceof Error ? error.message : String(error)
    return this.failure({ code: ErrorCode.Internal, message }, ExitCode.Internal)
  }

  private emitResult(document: Record<string, unknown>, humanRender: () => string): void {
    /* istanbul ignore if -- guards a CLI bug; no command emits twice */
    if (this.resultEmitted) return
    this.resultEmitted = true

    if (this.mode === 'json') {
      this.streams.out(`${JSON.stringify(document)}\n`)
      return
    }

    const rendered = humanRender()
    const target = document.ok === true ? this.streams.out : this.streams.err
    target(rendered.endsWith('\n') ? rendered : `${rendered}\n`)
  }
}

/** Reporter bound to the real process streams. */
export function createProcessReporter(options: { json?: boolean; noJson?: boolean; quiet?: boolean }): Reporter {
  return new Reporter({
    mode: resolveOutputMode({ json: options.json, noJson: options.noJson, isTTY: Boolean(process.stdout.isTTY) }),
    quiet: options.quiet,
    streams: {
      out: (text) => process.stdout.write(text),
      err: (text) => process.stderr.write(text),
    },
  })
}

/**
 * Column-aligned plain text — no box drawing, so it survives a narrow terminal.
 *
 * Lives with the other output concerns. It used to sit in `commands/devices.ts`,
 * which made `commands/debug.ts` import its table formatter from the devices
 * command — a dependency between two unrelated commands for no reason.
 */
export function renderTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => (row[column] ?? '').length)),
  )
  const line = (cells: string[]) =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column])))
      .join('  ')
      .trimEnd()
  return [line(headers), ...rows.map(line)].join('\n')
}
