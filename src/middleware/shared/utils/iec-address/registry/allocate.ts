/**
 * Deterministic address allocator.
 *
 * Given the registered consumers, assigns every channel a concrete IEC
 * address. Two passes:
 *   1. Reserve `pinned` channels at their literal address (fixed hardware).
 *   2. Allocate the rest, lowest-free-index first, per independent prefix
 *      space.
 *
 * Order is stable (consumer `order` then `id`, channels in declaration
 * order) so the output is reproducible across sessions — re-opening a
 * project never gratuitously renumbers. Non-pinned channels never collide
 * (they take the lowest FREE slot); only two pinned channels on the same
 * literal address produce a conflict, reported first-wins.
 */

import { formatAddress, parseAddress, prefixOf } from './address-space'
import type { AddressConflict, AllocateOptions, AllocationResult, RegistryConsumer } from './types'

/** Stable, unambiguous map key for a channel assignment. JSON-encoding the
 *  pair means ids may contain any characters without risking a collision. */
export function channelKey(consumerId: string, channelId: string): string {
  return JSON.stringify([consumerId, channelId])
}

/** Consumers in deterministic allocation order (does not mutate input). */
function orderedConsumers(consumers: readonly RegistryConsumer[]): RegistryConsumer[] {
  return [...consumers].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
}

/** Lowest non-negative integer not present in `set`. */
function lowestFree(set: ReadonlySet<number>): number {
  let i = 0
  while (set.has(i)) i++
  return i
}

/** First assignment key already resolved to `address` (the conflict winner). */
function firstKeyAt(assignments: Record<string, string>, address: string): string {
  for (const [key, addr] of Object.entries(assignments)) {
    if (addr === address) return key
  }
  /* istanbul ignore next -- unreachable: only called after an address was
     already recorded in `assignments` during pass 1 */
  return ''
}

export function allocateAddresses(
  consumers: readonly RegistryConsumer[],
  options: AllocateOptions = {},
): AllocationResult {
  const { activeKinds } = options
  const ordered = orderedConsumers(consumers).filter((c) => !activeKinds || activeKinds.has(c.kind))
  const assignments: Record<string, string> = {}
  const conflicts: AddressConflict[] = []
  // prefix -> set of claimed linear slot indices
  const usedByPrefix = new Map<string, Set<number>>()
  const conflictByAddress = new Map<string, AddressConflict>()

  const used = (prefix: string): Set<number> => {
    let set = usedByPrefix.get(prefix)
    if (!set) {
      set = new Set<number>()
      usedByPrefix.set(prefix, set)
    }
    return set
  }

  // Pass 1 — reserve pinned (fixed) channels.
  for (const consumer of ordered) {
    for (const channel of consumer.channels) {
      if (!channel.pinned) continue
      const key = channelKey(consumer.id, channel.channelId)
      const parsed = parseAddress(channel.pinned)
      // Unparseable pinned addresses are honoured verbatim but can't take
      // part in the linear reservation — record the assignment and move on.
      if (!parsed) {
        assignments[key] = channel.pinned
        continue
      }
      const set = used(prefixOf(parsed.cls))
      if (set.has(parsed.linear)) {
        const existing = conflictByAddress.get(channel.pinned)
        if (existing) {
          existing.keys.push(key)
        } else {
          const report: AddressConflict = {
            address: channel.pinned,
            keys: [firstKeyAt(assignments, channel.pinned), key],
          }
          conflictByAddress.set(channel.pinned, report)
          conflicts.push(report)
        }
        // Loser still records the (colliding) address it asked for.
        assignments[key] = channel.pinned
        continue
      }
      set.add(parsed.linear)
      assignments[key] = channel.pinned
    }
  }

  // Pass 2 — allocate non-pinned channels at the lowest free slot.
  for (const consumer of ordered) {
    for (const channel of consumer.channels) {
      if (channel.pinned) continue
      const prefix = prefixOf(channel.class)
      const set = used(prefix)
      const linear = lowestFree(set)
      set.add(linear)
      assignments[channelKey(consumer.id, channel.channelId)] = formatAddress(channel.class, linear)
    }
  }

  return { assignments, conflicts }
}
