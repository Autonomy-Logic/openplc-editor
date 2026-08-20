/**
 * The debug-session wire protocol: NDJSON request/response over a local socket.
 *
 * Why a protocol at all, rather than a REPL reading stdin: a debug session is
 * long-lived and stateful, but the callers that matter — a test step, an AI
 * agent — are stateless and turn-based, one fresh process per command. Feeding
 * an interactive process and matching on its prompt to decide when a reply has
 * finished is the flaky-test tarpit; a framed request/response makes completion
 * explicit.
 *
 * Choices that follow from that, and the reasons they are not arbitrary:
 *
 *   - NDJSON, not JSON-RPC. One JSON document per line, no envelope
 *     ceremony. JSON-RPC's batching and notification semantics buy nothing
 *     here and its error-object shape is weaker than `ErrorCode`.
 *   - Every request carries an `id`, echoed on the response. A caller knows a
 *     reply is complete when the line ends, and knows WHICH request it answers
 *     without assuming ordering — so a future pipelined client does not need a
 *     protocol change.
 *   - `Response` is a discriminated union on `ok`, so an exhaustive switch is
 *     checkable and a new response kind cannot be silently unhandled.
 *
 * The REPL speaks exactly this. It is a client, not a second implementation:
 * every command a human types becomes one of these requests, which is what
 * keeps "debug from the terminal" and "debug from a script" the same code.
 */

import type { ErrorCodeValue } from '../exit-codes'

/** Every operation a session understands. The REPL's vocabulary is this set. */
export type RequestKind =
  | 'status'
  | 'list-vars'
  | 'read'
  | 'write'
  | 'force'
  | 'unforce'
  | 'start'
  | 'stop'
  | 'watch'
  | 'poll'
  | 'unwatch'
  | 'close'

export interface RequestBase {
  /** Correlates the response. Unique per connection, not globally. */
  id: number
  kind: RequestKind
}

/** Connection state, target, program MD5, PLC state, and what is forced. */
export interface StatusRequest extends RequestBase {
  kind: 'status'
}

/** Every leaf in the compiled program's debug map. */
export interface ListVarsRequest extends RequestBase {
  kind: 'list-vars'
  /** Case-insensitive substring filter on the variable path. */
  filter?: string
}

export interface ReadRequest extends RequestBase {
  kind: 'read'
  /** Variable paths, as they appear in `debug-map.json` (case-insensitive). */
  names: string[]
}

/** Soft write — the program may overwrite it on the next scan. */
export interface WriteRequest extends RequestBase {
  kind: 'write'
  name: string
  value: string
}

/** Force — pinned until unforced; survives the program's own writes. */
export interface ForceRequest extends RequestBase {
  kind: 'force'
  name: string
  value: string
}

export interface UnforceRequest extends RequestBase {
  kind: 'unforce'
  name: string
}

export interface StartRequest extends RequestBase {
  kind: 'start'
}

export interface StopRequest extends RequestBase {
  kind: 'stop'
}

/**
 * Begin recording a variable into a bounded server-side buffer.
 *
 * Recording rather than streaming is the whole point: a stateless caller
 * cannot sit and watch a scroll, and a test needs to assert that a transient
 * happened between two of its own steps. The session samples; `poll` drains.
 */
export interface WatchRequest extends RequestBase {
  kind: 'watch'
  names: string[]
  /** Sampling period. Clamped by the session to what the medium can carry. */
  intervalMs?: number
}

/** Drain the recorded window. `since` continues a previous drain. */
export interface PollRequest extends RequestBase {
  kind: 'poll'
  since?: number
}

export interface UnwatchRequest extends RequestBase {
  kind: 'unwatch'
  /** Omit to stop watching everything. */
  names?: string[]
}

/** Tear the session down. See `releaseForces` for the safety-relevant part. */
export interface CloseRequest extends RequestBase {
  kind: 'close'
  /**
   * Unforce everything this session forced before disconnecting.
   *
   * Defaults to true, and that default is a safety decision, not a
   * convenience: forcing lives in the RUNTIME's forced-slot bitmap, and the
   * runtime has no way to notice that a debugger went away — it only clears
   * forces on program unload/stop (`debug_write_journal_reset`). A session
   * that exits quietly therefore leaves outputs pinned on a live PLC. Tests
   * that open and close sessions in a loop would strand forces on real
   * hardware. Pass false only when the pin is meant to outlive the session.
   */
  releaseForces?: boolean
}

export type Request =
  | StatusRequest
  | ListVarsRequest
  | ReadRequest
  | WriteRequest
  | ForceRequest
  | UnforceRequest
  | StartRequest
  | StopRequest
  | WatchRequest
  | PollRequest
  | UnwatchRequest
  | CloseRequest

/** One variable's current value, typed so `0` is never ambiguous. */
export interface VariableValue {
  /** Path from `debug-map.json`, in its canonical casing. */
  name: string
  /** Canonical IEC type straight from the compiler (e.g. `DINT`). */
  type: string
  /**
   * The decoded value. A BOOL is a boolean, an integer a number, a 64-bit
   * integer a decimal string (it does not survive an IEEE double), a STRING a
   * string. `null` means the leaf was unreadable this sample.
   */
  value: boolean | number | string | null
  /** True when the runtime reports this leaf pinned. */
  forced: boolean
}

export interface SessionStatus {
  sessionId: string
  connected: boolean
  target: string
  /** Transport actually in use, e.g. `websocket`, `tcp`, `rtu`. */
  transport: string
  descriptor: string
  projectPath: string
  /** MD5 of the program the target is running, per `debugger:verify-md5`. */
  programMd5: string | null
  /** Whether that MD5 matches the locally compiled artifacts. */
  md5Matches: boolean
  plcState: 'running' | 'stopped' | 'unknown'
  /** Paths this session has forced and not yet released. */
  forced: string[]
  watching: string[]
  startedAt: string
  lastActivityAt: string
}

/** One recorded sample from the watch buffer. */
export interface WatchSample {
  /** Monotonic sequence number — pass the last one back as `poll --since`. */
  seq: number
  /** Milliseconds since the session started, not a wall clock. */
  atMs: number
  values: VariableValue[]
}

export interface OkResponse {
  id: number
  ok: true
  /** Shape depends on the request kind; each command knows its own. */
  data:
    | { kind: 'status'; status: SessionStatus }
    | { kind: 'list-vars'; variables: Array<{ name: string; type: string; size: number }> }
    | { kind: 'read'; values: VariableValue[] }
    | { kind: 'write'; value: VariableValue }
    | { kind: 'force'; value: VariableValue }
    | { kind: 'unforce'; value: VariableValue }
    | { kind: 'plc-state'; plcState: 'running' | 'stopped' }
    | { kind: 'watch'; watching: string[]; intervalMs: number }
    | { kind: 'poll'; samples: WatchSample[]; dropped: number }
    | { kind: 'unwatch'; watching: string[] }
    | { kind: 'close'; released: string[] }
}

export interface ErrResponse {
  id: number
  ok: false
  error: { code: ErrorCodeValue; message: string; details?: unknown }
}

export type Response = OkResponse | ErrResponse

/** Serialize one message as a protocol line (trailing newline included). */
export function encodeMessage(message: Request | Response): string {
  return `${JSON.stringify(message)}\n`
}

/**
 * Split a raw socket chunk into complete lines, returning the trailing partial
 * for the caller to prepend to the next chunk.
 *
 * A socket boundary lands mid-line often enough that parsing per chunk is a
 * real bug rather than a theoretical one — a 500-variable `list-vars` reply
 * does not arrive in one piece.
 */
export function splitLines(buffered: string, chunk: string): { lines: string[]; rest: string } {
  const combined = buffered + chunk
  const parts = combined.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.filter((line) => line.trim().length > 0), rest }
}
