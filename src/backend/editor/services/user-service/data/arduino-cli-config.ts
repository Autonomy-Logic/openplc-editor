/**
 * Reconcile an existing `arduino-cli.yaml` with the one the editor ships.
 *
 * The config used to be written once with `{ flag: 'wx' }` and skipped
 * forever after, so anything added to `ARDUINO_DATA` later never reached an
 * existing install — the only fix was deleting the file by hand. This brings
 * a stale file up to date in place.
 *
 * Two rules, and deliberately only two:
 *
 * - **Add missing board-manager URLs.** Never remove one: users add their own
 *   vendor indexes here, and VPP-declared indexes arrive at compile time.
 * - **Drop `output.no_color`.** The editor forced it on to stop raw `ESC[92m`
 *   bytes appearing in the console. The console now renders SGR colour
 *   itself, so the suppression is obsolete; leaving it behind would silently
 *   keep colour off on every machine that has ever launched an older build.
 *
 * Everything else is left exactly as the user left it, comments and ordering
 * included — hence the `Document` API for the existing file rather than a
 * parse/serialise round-trip through plain objects.
 */

import { isMap, isSeq, parse, parseDocument } from 'yaml'

const BOARD_MANAGER_URLS_PATH = ['board_manager', 'additional_urls']

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Board-manager URLs declared by the shipped template (which we author). */
function shippedBoardManagerUrls(shipped: string): string[] {
  const parsed: unknown = parse(shipped)
  if (!isRecord(parsed)) return []

  const boardManager = parsed.board_manager
  if (!isRecord(boardManager)) return []

  const urls = boardManager.additional_urls
  return Array.isArray(urls) ? urls.filter((url): url is string => typeof url === 'string') : []
}

/**
 * Return the updated file contents, or `null` when nothing needed changing.
 *
 * Also returns `null` when `existing` is unparseable — a broken config is the
 * user's to fix, and rewriting it would discard whatever they were editing.
 */
export function reconcileArduinoCliConfig(existing: string, shipped: string): string | null {
  const doc = parseDocument(existing)
  if (doc.errors.length > 0) return null

  let changed = false

  // Nested `*In()` calls walk the tree and throw ("Expected YAML collection
  // at board_manager") if a parent turns out to be a scalar. A hand-edited
  // config can absolutely be parseable-but-odd, and throwing here would abort
  // the whole reconciliation — leaving the user with no migration and only a
  // console error to explain it. So fetch each parent and check it first.
  const boardManager = doc.get('board_manager')
  const output = doc.get('output')

  // 1. Board-manager URLs — union, never subtract.
  const shippedUrls = shippedBoardManagerUrls(shipped)
  if (shippedUrls.length > 0 && (boardManager === undefined || boardManager === null || isMap(boardManager))) {
    const current = isMap(boardManager) ? boardManager.get('additional_urls') : undefined
    const present = new Set<string>(isSeq(current) ? current.toJSON().map(String) : [])
    const missing = shippedUrls.filter((url) => !present.has(url))

    if (missing.length > 0) {
      if (isSeq(current)) {
        for (const url of missing) current.add(url)
      } else {
        // No `additional_urls` key, or it is not a list — install the shipped
        // set wholesale rather than guessing at a merge.
        doc.setIn(BOARD_MANAGER_URLS_PATH, shippedUrls)
      }
      changed = true
    }
  }

  // 2. Retire the obsolete colour suppression.
  if (isMap(output) && output.has('no_color')) {
    output.delete('no_color')
    changed = true

    // Don't leave an empty `output:` behind once its only key is gone.
    if (output.items.length === 0) doc.delete('output')
  }

  return changed ? String(doc) : null
}
