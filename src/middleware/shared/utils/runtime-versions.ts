/**
 * The runtime versions a device can be moved to (RTOP-283).
 *
 * Read from the runtime repository's git tags, which is where releases are
 * cut and what the container registry publishes an image for -- so a tag
 * listed here is a tag the device can actually pull. Asking a user to type a
 * version invites a typo that the device then refuses minutes later, or worse
 * a plausible-looking tag that does not exist.
 *
 * Unauthenticated. GitHub's API sends permissive CORS headers, so this works
 * from the browser app and the editor alike, and the rate limit (60/hour per
 * address) is far above what opening a dialog costs. The result is cached for
 * the session because the tag list does not change while somebody is looking
 * at it.
 */

const TAGS_URL = 'https://api.github.com/repos/Autonomy-Logic/openplc-runtime/tags?per_page=100'

/** How long a fetched list stays fresh. Releases are not minutes apart. */
const CACHE_TTL_MS = 10 * 60 * 1000

/**
 * How long to wait for GitHub before giving up.
 *
 * Long enough for a slow connection, short enough that the offline fallback
 * appears while somebody is still looking at the dialog.
 */
const FETCH_TIMEOUT_MS = 8000

export type RuntimeVersion = {
  /** The tag exactly as it must be sent to the bootloader, e.g. "v4.2.1". */
  tag: string
  /** A tag carrying a pre-release suffix, e.g. "v4.1.0-rc.1". */
  prerelease: boolean
}

export type RuntimeVersionsResult =
  | { ok: true; versions: RuntimeVersion[] }
  | { ok: false; error: string }

let cache: { at: number; versions: RuntimeVersion[] } | null = null

/**
 * Only `vX.Y.Z`, optionally with a pre-release suffix.
 *
 * The repository carries other tags over time, and a tag that is not a release
 * has no published image behind it -- offering one would produce a failed
 * pull with a confusing message.
 */
const RELEASE_TAG = /^v(\d+)\.(\d+)\.(\d+)(?:-(.+))?$/

/** Newest first, comparing numerically so v4.1.10 sorts above v4.1.9. */
function compareVersions(a: string, b: string): number {
  const left = RELEASE_TAG.exec(a)
  const right = RELEASE_TAG.exec(b)
  if (!left || !right) return a < b ? 1 : -1

  for (let i = 1; i <= 3; i += 1) {
    const diff = Number(right[i]) - Number(left[i])
    if (diff !== 0) return diff
  }
  // A release outranks its own pre-releases: v4.2.0 before v4.2.0-rc.1.
  const leftPre = left[4]
  const rightPre = right[4]
  if (!leftPre && rightPre) return -1
  if (leftPre && !rightPre) return 1
  if (!leftPre && !rightPre) return 0
  return rightPre < leftPre ? -1 : 1
}

/**
 * Fetch the installable runtime versions.
 *
 * A failure is reported rather than thrown: the caller falls back to letting
 * the version be typed, which is what keeps an editor with no internet able to
 * install a version the device already holds.
 */
export async function listRuntimeVersions(signal?: AbortSignal): Promise<RuntimeVersionsResult> {
  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return { ok: true, versions: cache.versions }
  }

  try {
    // A timeout of our own, combined with the caller's signal.
    //
    // Without it a black-holed api.github.com -- filtered DNS, a captive
    // portal -- left `fetch` hanging for the browser's TCP timeout with the
    // fallback field disabled behind `loadingVersions`. The offline path this
    // function exists to provide was unreachable in exactly the situation that
    // needs it.
    const signals: AbortSignal[] = [AbortSignal.timeout(FETCH_TIMEOUT_MS)]
    if (signal) signals.push(signal)

    const response = await fetch(TAGS_URL, {
      signal: AbortSignal.any(signals),
      headers: { Accept: 'application/vnd.github+json' },
    })
    if (!response.ok) {
      // 403 here is almost always the anonymous rate limit, which is worth
      // saying plainly rather than reporting as a generic failure.
      if (response.status === 403) {
        return { ok: false, error: 'GitHub is rate-limiting this address; try again shortly.' }
      }
      return { ok: false, error: `Could not read the version list (HTTP ${response.status}).` }
    }

    const body: unknown = await response.json()
    if (!Array.isArray(body)) {
      return { ok: false, error: 'The version list came back in an unexpected shape.' }
    }

    // flatMap with a real guard, not a cast. A `null` element -- or any entry
    // that is not an object -- made the cast throw on property access, which
    // landed in the catch below and was reported as "could not reach GitHub",
    // discarding every valid tag alongside it.
    const versions = body
      .flatMap((entry) =>
        typeof entry === 'object' &&
        entry !== null &&
        'name' in entry &&
        typeof (entry as { name: unknown }).name === 'string'
          ? [(entry as { name: string }).name]
          : [],
      )
      .filter((name) => RELEASE_TAG.test(name))
      .sort(compareVersions)
      .map((tag) => ({ tag, prerelease: tag.includes('-') }))

    if (versions.length === 0) {
      return { ok: false, error: 'No runtime releases were found.' }
    }

    cache = { at: Date.now(), versions }
    return { ok: true, versions }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, error: 'GitHub did not answer in time.' }
    }
    if (error instanceof DOMException && error.name === 'AbortError') {
      // The caller's signal: the dialog closed. Not worth reporting.
      return { ok: false, error: 'cancelled' }
    }
    return {
      ok: false,
      error: 'Could not reach GitHub to list the available versions.',
    }
  }
}

/** Drop the cache, so a retry actually re-fetches. */
export function clearRuntimeVersionsCache(): void {
  cache = null
}
