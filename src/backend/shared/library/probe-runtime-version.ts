/**
 * Probe the openplc-runtime container's `/api/version` and return
 * the canonical `{ version, error? }` shape the shared compile
 * pipeline's strucpp-compatibility gate consumes.
 *
 * Single source of truth for the response-parsing + null-handling
 * logic that used to live duplicated in editor's
 * `editor-compiler-platform-port.ts:checkRuntimeVersion` and web's
 * `web-compiler-platform-port.ts:checkRuntimeVersion`.  Both
 * platforms now call this helper with a transport-specific
 * `fetchVersion()` callback; everything from "got a response" to
 * "what version is this" lives here.
 *
 * The runtime container is the SAME openplc-runtime build on both
 * platforms — editor reaches it over direct HTTPS, web reaches it
 * via the orchestrator's `run-command` proxy.  Both endpoints return
 * a body shaped like `{ version: '4.1.x' }`; this helper extracts
 * the field and surfaces it (or `null`) to the caller.
 *
 * Returns `version: null` on any failure path (transport error,
 * missing field, parse failure) so the shared
 * `isStrucppCompatibleRuntime` gate uniformly rejects "unknown"
 * answers the same way it rejects pre-4.1.0 versions — matching the
 * editor's pre-refactor behaviour where an unreachable runtime
 * blocked the upload.
 *
 * Pure: no I/O.  Caller supplies the transport via `fetchVersion`.
 */

// Relative import on purpose: `npm run validate:arch` only inspects relative
// specifiers, so this path is actually checked against the layer rules —
// `backend-shared -> utils` is allowed.
import { isValidVersion } from '../../../frontend/utils/semver'

/** Outcome of the transport-level fetch.  Adapters return this from
 *  their HTTPS / orchestrator round-trip; the shared helper takes
 *  it from here. */
export type FetchVersionResult =
  | {
      /** Transport succeeded and parsed a JSON-ish body.  The
       *  helper looks for a top-level `version` field of type
       *  `string`. */
      success: true
      body: unknown
    }
  | {
      /** Transport failed.  `error` lands in the log line as the
       *  reachability diagnostic; `version` becomes `null`. */
      success: false
      error: string
    }

export interface ProbeRuntimeVersionOptions {
  /** Transport callback: editor uses Electron's HTTPS bridge to
   *  hit the device's `/api/version`; web POSTs to the
   *  orchestrator's `run-command` with `api: 'api/version'`. */
  fetchVersion(): Promise<FetchVersionResult>
  /**
   * Transport callback for `GET /api/capabilities` — the endpoint
   * where a runtime declares what it requires of an editor
   * (DOPE-448).  Optional: a platform that hasn't wired it up yet
   * behaves exactly as before.
   *
   * A runtime predating the endpoint does NOT answer 404.  Its
   * `restapi.py` ends in a catch-all `@restapi_bp.route("/<command>")`
   * guarded by `@jwt_required()`, so an unknown path under `/api/`
   * falls into it and comes back as **401 Missing Authorization
   * Header** — verified against a real pre-DOPE-448 container.  Both
   * outcomes land here the same way (a failed fetch, or a body with
   * no `runtimeVersion`), which is why this probe keys off "can I
   * read a version out of the answer" rather than off a status code.
   *
   * Either way `minEditorVersion` comes back `null`, meaning "this
   * runtime declares no floor" — never "the editor is too old".
   */
  fetchCapabilities?(): Promise<FetchVersionResult>
  /** Warning channel for diagnostics the user can see in the
   *  compile console (e.g. "Could not reach runtime: ECONNREFUSED").
   *  Wired to the platform port's `log` callback by the caller so
   *  the message stays in the pipeline's event stream. */
  log(message: string, level: 'warning'): void
}

export interface ProbeRuntimeVersionResult {
  /** The runtime's reported version (e.g. `'4.1.2'`), or `null`
   *  when the probe couldn't extract one.  The shared compile
   *  pipeline feeds this verbatim to `isStrucppCompatibleRuntime`. */
  version: string | null
  /**
   * The oldest editor this runtime accepts programs from, as
   * declared at `GET /api/capabilities`, or `null` when the runtime
   * declares nothing — it predates the endpoint, the platform has no
   * transport for it, or the field was missing/malformed.
   *
   * `null` must be treated as "no constraint", not as a failure: it
   * is the state of every runtime currently in the field, and the
   * whole point of the runtime advertising rather than enforcing is
   * that shipping this can't lock those out.
   */
  minEditorVersion: string | null
  /**
   * Whether this runtime stores the source project an upload carries, as
   * declared by `projectSnapshot` at `GET /api/capabilities`.
   *
   * `false` for every runtime that predates the feature, including those that
   * predate the endpoint entirely -- which is the honest default, because a
   * runtime that does not advertise it will silently discard the archive. The
   * upload path uses this to skip building one and to say why, rather than
   * sending several megabytes into a device that will drop them and leaving the
   * user to wonder later why the project cannot be retrieved.
   */
  supportsProjectSnapshot: boolean
}

/**
 * Run the probe.  Always resolves — never throws — so the pipeline
 * gets a deterministic answer it can branch on.
 *
 * `/api/capabilities` is preferred where available because it carries
 * both halves of the compatibility question in one round-trip, and it
 * reports the version under `runtimeVersion` rather than `version`.
 * When it is absent or unusable the probe falls back to
 * `/api/version`, which every runtime has.
 */
export async function probeRuntimeVersion(opts: ProbeRuntimeVersionOptions): Promise<ProbeRuntimeVersionResult> {
  const capabilities = await tryFetchCapabilities(opts)
  if (capabilities) return capabilities

  try {
    const result = await opts.fetchVersion()
    if (!result.success) {
      opts.log(`Could not reach runtime: ${result.error}`, 'warning')
      return { version: null, minEditorVersion: null, supportsProjectSnapshot: false }
    }
    return {
      version: extractVersionFromBody(result.body),
      minEditorVersion: null,
      // `/api/version` predates the capability, so there is nothing to read.
      supportsProjectSnapshot: false,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    opts.log(`Runtime version probe failed: ${message}`, 'warning')
    return { version: null, minEditorVersion: null, supportsProjectSnapshot: false }
  }
}

/**
 * Attempt the capabilities endpoint.  Returns null — meaning "fall
 * back to /api/version" — for every unusable outcome: no transport
 * wired, a 404 from a runtime that predates the endpoint, a thrown
 * transport error, or a body with no usable `runtimeVersion`.
 *
 * A partial answer is deliberately not accepted.  If we cannot read
 * the version out of this response we do not trust the
 * `minEditorVersion` beside it either, and `/api/version` is the
 * authority on the version anyway.
 */
async function tryFetchCapabilities(opts: ProbeRuntimeVersionOptions): Promise<ProbeRuntimeVersionResult | null> {
  if (!opts.fetchCapabilities) return null
  try {
    const result = await opts.fetchCapabilities()
    if (!result.success) {
      // Expected against every runtime older than the endpoint — in
      // practice a 401 from the `/<command>` catch-all, not a 404 — so
      // this is an ordinary fact, not a problem worth a warning.
      return null
    }
    const version = extractStringField(result.body, 'runtimeVersion')
    if (version === null) return null
    const minEditorVersion = extractStringField(result.body, 'minEditorVersion')
    // A floor that is present but unreadable is the one case that must not
    // pass in silence.  `isVersionAtLeast` treats it as "declares nothing",
    // which is the safe answer for an upload but the wrong one for whoever
    // wrote it: the runtime believes it is enforcing a constraint that is
    // not being applied, and without this line the only way to find out is a
    // field incident.  Accepted shorthands (`"4.3"`, `"4"`, `"v5"`) parse, so
    // this fires on genuine junk only.
    if (minEditorVersion !== null && !isValidVersion(minEditorVersion)) {
      opts.log(
        `Runtime declared an unreadable minEditorVersion ("${minEditorVersion}") — the editor-version floor is not being enforced.`,
        'warning',
      )
    }
    return {
      version,
      minEditorVersion,
      // Absent or non-boolean means no: a runtime that stores snapshots says so.
      supportsProjectSnapshot: extractBooleanField(result.body, 'projectSnapshot') === true,
    }
  } catch {
    return null
  }
}

/**
 * Pull the top-level `version` field out of the runtime's response
 * body.  The runtime emits `{ version: '4.1.x' }`; everything else
 * (missing field, non-string value, unexpected shape) collapses to
 * `null` so the strucpp-compatibility gate treats the unknown
 * answer as incompatible.
 */
function extractVersionFromBody(body: unknown): string | null {
  return extractStringField(body, 'version')
}

/**
 * Read a top-level string field out of a response body, collapsing
 * every other shape (not an object, field absent, field not a string)
 * to `null` so callers get one "unknown" value to branch on instead of
 * having to distinguish the ways a body can disappoint them.
 */
/**
 * One boolean field off an unknown response body, or null when it is not there
 * or is not a boolean. A capability the runtime did not clearly claim is one it
 * does not have.
 */
function extractBooleanField(body: unknown, field: string): boolean | null {
  if (typeof body !== 'object' || body === null) return null
  const value = (body as Record<string, unknown>)[field]
  return typeof value === 'boolean' ? value : null
}

function extractStringField(body: unknown, field: string): string | null {
  if (typeof body !== 'object' || body === null) return null
  if (!(field in body)) return null
  const value = (body as Record<string, unknown>)[field]
  return typeof value === 'string' ? value : null
}
