import { v4 as uuidv4 } from 'uuid'

/**
 * The one place in `src/` allowed to mint a UUID.
 *
 * `crypto.randomUUID` is secure-context-only, and autonomy-node serves this
 * bundle over plain HTTP — so on a node accessed by IP the global is simply
 * absent and any direct call throws. `uuid`'s v4 already handles that: it
 * uses `crypto.randomUUID` when present and otherwise falls back to
 * `crypto.getRandomValues`, which every context provides. Routing every call
 * through here keeps that single decision in one file instead of asking each
 * call site to remember it (see the `no-restricted-properties` lint guard).
 *
 * What actually warrants a UUID is an id persisted into a project file, which
 * must not collide across sessions, machines or copy-paste — FBD blocks,
 * ladder/FBD rungs, graphical editor nodes. A purely in-memory id is better
 * minted by whoever owns the list (the console slice keys its own entries off
 * a sequence for that reason). One call site is neither: `plc-logs` memoises a
 * UUID per v3 log line to key a list it does not own; it is routed here so the
 * lint guard stays absolute, but a sequence owned by that component would suit
 * it better.
 */
export const newUuid = (): string => uuidv4()
