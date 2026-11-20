/** Completion items of PLC documents: library POUs a PLC build cannot use are not offered. */
import { parseHmiFileUri } from '../hmi-code/uris'
import { HMI_GLUE_URI } from './hmi-sync'

/** A completion item's label, plain or with details. */
type CompletionLabel = string | { label: string }

/**
 * `items` without the library POUs `unusable` names (upper case), for any document but an HMI screen, widget block or
 * the HMI glue, which HMI builds compile and which may use them.
 */
export function plcCompletionItems<T extends { label: CompletionLabel }>(
  uri: string,
  items: T[],
  unusable: readonly string[],
): T[] {
  if (unusable.length === 0 || uri === HMI_GLUE_URI || parseHmiFileUri(uri) !== null) return items
  const hidden = new Set(unusable)
  return items.filter((item) => {
    const label = typeof item.label === 'string' ? item.label : item.label.label
    return !hidden.has(label.toUpperCase())
  })
}
