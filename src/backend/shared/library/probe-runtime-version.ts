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
}

/**
 * Run the probe.  Always resolves — never throws — so the pipeline
 * gets a deterministic answer it can branch on.
 */
export async function probeRuntimeVersion(opts: ProbeRuntimeVersionOptions): Promise<ProbeRuntimeVersionResult> {
  try {
    const result = await opts.fetchVersion()
    if (!result.success) {
      opts.log(`Could not reach runtime: ${result.error}`, 'warning')
      return { version: null }
    }
    return { version: extractVersionFromBody(result.body) }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    opts.log(`Runtime version probe failed: ${message}`, 'warning')
    return { version: null }
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
  if (typeof body !== 'object' || body === null) return null
  if (!('version' in body)) return null
  const v = (body as { version: unknown }).version
  return typeof v === 'string' ? v : null
}
