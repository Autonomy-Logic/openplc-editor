/**
 * Process exit codes — the CLI's coarsest machine-readable channel.
 *
 * A test step reads the exit code before it reads anything else, so the codes
 * distinguish the cases a caller actually branches on: "your input was wrong"
 * (retrying is pointless) from "the target misbehaved" (retrying might help)
 * from "the program is bad" (fail the build). A single generic `1` forces
 * callers to parse prose to tell those apart, which is how test suites end up
 * matching on error strings.
 */
export const ExitCode = {
  /** Command completed and the answer is yes / done. */
  Ok: 0,
  /** Usage error: unknown command, missing or malformed argument. */
  Usage: 2,
  /** The project, file or session named by the caller does not exist. */
  NotFound: 3,
  /** Compilation ran and the program was rejected (diagnostics on stderr). */
  CompileFailed: 4,
  /** Could not reach the target, or lost it mid-command. */
  Connection: 5,
  /** Reached the target and it refused: bad credentials, or not authorized. */
  Auth: 6,
  /** The command ran but the target reported failure (upload rejected, write refused). */
  TargetError: 7,
  /** Timed out waiting for the target or for a session to answer. */
  Timeout: 8,
  /** Anything unanticipated — a bug in the CLI, not in the caller's input. */
  Internal: 70,
} as const

export type ExitCodeName = keyof typeof ExitCode
export type ExitCodeValue = (typeof ExitCode)[ExitCodeName]

/**
 * Stable error codes carried in structured output alongside the exit code.
 *
 * The exit code says which *class* of thing went wrong; this says which
 * specific thing, so a caller can assert on a code instead of on a sentence.
 * Prose messages are free to change; these are not.
 */
export const ErrorCode = {
  UnknownCommand: 'unknown_command',
  MissingArgument: 'missing_argument',
  InvalidArgument: 'invalid_argument',
  ProjectNotFound: 'project_not_found',
  ProjectInvalid: 'project_invalid',
  TargetUnknown: 'target_unknown',
  CompileFailed: 'compile_failed',
  SessionNotFound: 'session_not_found',
  SessionStale: 'session_stale',
  VariableNotFound: 'variable_not_found',
  ValueInvalid: 'value_invalid',
  NotConnected: 'not_connected',
  AuthRequired: 'auth_required',
  AuthRejected: 'auth_rejected',
  UploadRejected: 'upload_rejected',
  Md5Mismatch: 'md5_mismatch',
  Timeout: 'timeout',
  Internal: 'internal',
} as const

export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode]
