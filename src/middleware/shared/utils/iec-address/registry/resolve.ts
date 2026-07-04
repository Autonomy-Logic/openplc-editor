/**
 * Compile-time resolution of a program variable's location field.
 *
 * A variable's location holds EITHER an alias name OR a literal IEC address.
 * The compiler only understands IEC addresses, so the editor resolves:
 *   - literal `%…`            → used verbatim (manual locations are honoured
 *                               exactly as typed; the allocator neither
 *                               reserves nor avoids them);
 *   - alias that still exists → the alias's current address;
 *   - alias that is gone      → empty location (variable becomes unlocated).
 */

import { channelKey } from './allocate'
import type { IecAddressRegistry } from './types'

/** Build the `alias → assigned address` lookup from the registry. Aliases
 *  without an assignment (e.g. a channel whose address failed to allocate)
 *  are omitted. Later duplicate aliases are ignored (first wins) — the
 *  `setAlias` gate prevents duplicates from being created in the first
 *  place; this is defensive for hand-edited / migrated projects. */
export function buildAliasIndex(registry: IecAddressRegistry): Map<string, string> {
  const index = new Map<string, string>()
  for (const consumer of registry.consumers) {
    for (const channel of consumer.channels) {
      if (!channel.alias) continue
      if (index.has(channel.alias)) continue
      const address = registry.assignments[channelKey(consumer.id, channel.channelId)]
      if (address) index.set(channel.alias, address)
    }
  }
  return index
}

/** True when the string is a literal IEC location (starts with `%`) rather
 *  than an alias reference. Aliases can never start with `%`. */
export function isLiteralLocation(field: string): boolean {
  return field.startsWith('%')
}

/**
 * Resolve a variable's location field to the concrete IEC address the
 * compiler should emit. Returns `''` for an empty field or an alias that no
 * longer resolves (the emitters then drop the `AT %…`).
 */
export function resolveLocation(field: string, aliasIndex: ReadonlyMap<string, string>): string {
  if (!field) return ''
  if (isLiteralLocation(field)) return field
  return aliasIndex.get(field) ?? ''
}
