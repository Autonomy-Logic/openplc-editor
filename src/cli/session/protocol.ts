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

/**
 * Schemas are the single source of truth; the TypeScript types are inferred
 * from them. Two things follow, both load-bearing:
 *
 *   - Every line off the wire is VALIDATED rather than asserted. A malformed
 *     `names` is refused at the boundary, where the error names the field,
 *     instead of surfacing later as an unrelated failure deep inside a read.
 *   - The schema and the type cannot drift, because there is only one
 *     declaration of each shape.
 */

import { z } from 'zod'

/** Every operation a session understands. The REPL's vocabulary is this set. */
export const RequestKindSchema = z.enum([
  'status',
  'list-vars',
  'read',
  'write',
  'force',
  'unforce',
  'start',
  'stop',
  'watch',
  'poll',
  'unwatch',
  'close',
])
export type RequestKind = z.infer<typeof RequestKindSchema>

/** Correlates a response with its request; unique per connection. */
const idField = z.number().finite()

const nonEmptyNames = z.array(z.string()).min(1)

export const RequestSchema = z.discriminatedUnion('kind', [
  z.object({ id: idField, kind: z.literal('status') }),
  z.object({ id: idField, kind: z.literal('list-vars'), filter: z.string().optional() }),
  z.object({ id: idField, kind: z.literal('read'), names: nonEmptyNames }),
  /** Soft write — the program may overwrite it on the next scan. */
  z.object({ id: idField, kind: z.literal('write'), name: z.string(), value: z.string() }),
  /** Force — pinned until unforced; survives the program's own writes. */
  z.object({ id: idField, kind: z.literal('force'), name: z.string(), value: z.string() }),
  z.object({ id: idField, kind: z.literal('unforce'), name: z.string() }),
  z.object({ id: idField, kind: z.literal('start') }),
  z.object({ id: idField, kind: z.literal('stop') }),
  /**
   * Begin recording variables into a bounded server-side buffer.
   *
   * Recording rather than streaming is the whole point: a stateless caller
   * cannot sit and watch a scroll, and a test needs to assert that a transient
   * happened between two of its own steps. The session samples; `poll` drains.
   */
  z.object({
    id: idField,
    kind: z.literal('watch'),
    names: nonEmptyNames,
    intervalMs: z.number().finite().optional(),
  }),
  /** Drain the recorded window. `since` continues a previous drain. */
  z.object({ id: idField, kind: z.literal('poll'), since: z.number().finite().optional() }),
  /** Omit `names` to stop watching everything. */
  z.object({ id: idField, kind: z.literal('unwatch'), names: z.array(z.string()).optional() }),
  /**
   * Tear the session down.
   *
   * `releaseForces` defaults to true at the call site, and that default is a
   * safety decision rather than a convenience: forcing lives in the RUNTIME's
   * forced-slot bitmap, and the runtime has no way to notice a debugger going
   * away — it clears forces only on program unload/stop
   * (`debug_write_journal_reset`). A session that exits quietly therefore
   * leaves outputs pinned on a live PLC, and a test loop would strand them on
   * real hardware. Pass false only when the pin is meant to outlive the session.
   */
  z.object({ id: idField, kind: z.literal('close'), releaseForces: z.boolean().optional() }),
])
export type Request = z.infer<typeof RequestSchema>

/**
 * One variable's current value, typed so `0` is never ambiguous.
 *
 * A 64-bit integer arrives as a decimal string: it does not survive an IEEE
 * double, and silently losing precision on a LINT is worse than making the
 * caller parse. `null` means the leaf was unreadable in this sample.
 */
export const VariableValueSchema = z.object({
  name: z.string(),
  type: z.string(),
  value: z.union([z.boolean(), z.number(), z.string(), z.null()]),
  forced: z.boolean(),
})
export type VariableValue = z.infer<typeof VariableValueSchema>

export const PlcStateSchema = z.enum(['running', 'stopped', 'unknown'])

export const SessionStatusSchema = z.object({
  sessionId: z.string(),
  connected: z.boolean(),
  target: z.string(),
  /** Transport actually in use, e.g. `websocket`, `tcp`, `rtu`. */
  transport: z.string(),
  descriptor: z.string(),
  projectPath: z.string(),
  /** MD5 of the program the target is running. */
  programMd5: z.string().nullable(),
  /** Whether that MD5 matches the locally compiled artifacts. */
  md5Matches: z.boolean(),
  plcState: PlcStateSchema,
  /** Paths this session has forced and not yet released. */
  forced: z.array(z.string()),
  watching: z.array(z.string()),
  startedAt: z.string(),
  lastActivityAt: z.string(),
})
export type SessionStatus = z.infer<typeof SessionStatusSchema>

/** One recorded sample from the watch buffer. */
export const WatchSampleSchema = z.object({
  /** Monotonic sequence number — pass the last one back as `poll --since`. */
  seq: z.number(),
  /** Milliseconds since the session started, not a wall clock. */
  atMs: z.number(),
  values: z.array(VariableValueSchema),
})
export type WatchSample = z.infer<typeof WatchSampleSchema>

const ResponseDataSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('status'), status: SessionStatusSchema }),
  z.object({
    kind: z.literal('list-vars'),
    variables: z.array(z.object({ name: z.string(), type: z.string(), size: z.number() })),
  }),
  z.object({ kind: z.literal('read'), values: z.array(VariableValueSchema) }),
  z.object({ kind: z.literal('write'), value: VariableValueSchema }),
  z.object({ kind: z.literal('force'), value: VariableValueSchema }),
  z.object({ kind: z.literal('unforce'), value: VariableValueSchema }),
  z.object({ kind: z.literal('plc-state'), plcState: z.enum(['running', 'stopped']) }),
  z.object({ kind: z.literal('watch'), watching: z.array(z.string()), intervalMs: z.number() }),
  z.object({ kind: z.literal('poll'), samples: z.array(WatchSampleSchema), dropped: z.number() }),
  z.object({ kind: z.literal('unwatch'), watching: z.array(z.string()) }),
  z.object({ kind: z.literal('close'), released: z.array(z.string()) }),
])

export const OkResponseSchema = z.object({ id: z.number(), ok: z.literal(true), data: ResponseDataSchema })
export type OkResponse = z.infer<typeof OkResponseSchema>

export const ErrResponseSchema = z.object({
  id: z.number(),
  ok: z.literal(false),
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
})
export type ErrResponse = z.infer<typeof ErrResponseSchema>

export const ResponseSchema = z.discriminatedUnion('ok', [OkResponseSchema, ErrResponseSchema])
export type Response = z.infer<typeof ResponseSchema>

/** Serialize one message as a protocol line (trailing newline included). */
export function encodeMessage(message: Request | Response): string {
  return `${JSON.stringify(message)}\n`
}

/** Validate one wire line as a request, or undefined when it is not one. */
export function decodeRequest(line: string): Request | undefined {
  return decodeWith(RequestSchema, line)
}

/** Validate one wire line as a response, or undefined when it is not one. */
export function decodeResponse(line: string): Response | undefined {
  return decodeWith(ResponseSchema, line)
}

function decodeWith<T>(schema: z.ZodType<T>, line: string): T | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(line)
  } catch {
    return undefined
  }
  const result = schema.safeParse(parsed)
  return result.success ? result.data : undefined
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
