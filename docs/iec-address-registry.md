# Central IEC Address Registry — Architecture

> Status: **approved design, in implementation**
> Scope: `openplc-editor` + `openplc-web` (shared surface — byte-identical)
> Supersedes the scattered per-producer address allocators and the
> derived `address-pool` / `alias-registry` / `sync-variable-aliases` trio.

## 1. Motivation

IEC 61131-3 addresses are a **single, finite, shared resource**. Every
producer — pin mapping, VPP I/O modules, Modbus remote devices, EtherCAT
slaves, and anything added later — draws from the same address spaces
(`%IX`, `%QX`, `%IW`, `%QW`, `%MW`, …). Today each producer:

- stores its own addresses in its own domain records,
- allocates them with its own copy of the "find next free" loop
  (EtherCAT even has a *separate* bit-offset allocator), and
- owns its channels' aliases independently, reconciled to program
  variables only opportunistically.

The result is duplication, drift, and no project-wide gap reclamation
(deleting a consumer leaves holes). Aliases — the thing user code should
depend on — are the most fragmented of all.

**This design makes a single store the source of truth for consumers,
their address assignments, and their aliases.** Producers become thin
clients that *register channels* and *read addresses back*. User program
variables reference aliases (or manual literal addresses); the compiler
resolves them.

## 2. Concepts

- **Consumer** — anything that needs addresses: a VPP module in a slot, a
  Modbus IO group, an EtherCAT slave, a pin block. Identified by a stable
  `id`, tagged with a `kind`, and given a deterministic `order`.
- **Channel** — one address request inside a consumer. Has a **stable,
  address-independent `channelId`**, an address **class**, an optional
  **alias**, and an optional **pinned** literal address (fixed hardware).
  > The stable `channelId` is the linchpin: aliases and variable bindings
  > attach to the channel, **not** to the address, so when reallocation
  > moves the channel the alias follows it automatically.
- **Address class** — `{ direction: I|Q|M, size: X|B|W|D|L }`. Maps to a
  prefix (`%IX`, `%QB`, `%QW`, …). **Each prefix is an independent linear
  space — no byte/word/dword overlap** (matches the OpenPLC runtime, which
  uses separate typed buffers per prefix).
- **Assignment** — the derived `(consumerId, channelId) → address` map,
  recomputed by `recalculate()`.
- **Alias** — a user-facing name, **unique system-wide**, owned by the
  registry and attached to a channel.

## 3. The registry (source of truth)

Serialized as a dedicated project section:

```ts
interface IecAddressRegistry {
  consumers: RegistryConsumer[]              // the record
  assignments: Record<string, string>        // derived cache: key(cid,chid) -> address
}
interface RegistryConsumer {
  id: string
  kind: 'pin-mapping' | 'vpp-io' | 'modbus-tcp-remote' | 'ethercat' | string
  label?: string
  order: number                              // deterministic allocation order
  channels: RegistryChannel[]
}
interface RegistryChannel {
  channelId: string                          // stable, address-independent
  class: { direction: 'I'|'Q'|'M'; size: 'X'|'B'|'W'|'D'|'L' }
  alias?: string                             // unique system-wide; empty = none
  pinned?: string                            // fixed hardware address → reserved, not allocated
}
```

Producers keep only their **domain** config (a Modbus group still has its
function code, cycle time, etc.) plus the `consumerId` they registered
under. They no longer store IEC addresses or aliases.

## 4. Generic API

```ts
// pure core (framework-agnostic); a Zustand slice wraps it 1:1
createRegistry(): IecAddressRegistry
addConsumer(reg, consumer): IecAddressRegistry            // append + recalculate
removeConsumer(reg, consumerId): IecAddressRegistry        // drop + recalculate (fills gaps)
updateConsumer(reg, consumerId, patch): IecAddressRegistry // change channels/order + recalculate
setAlias(reg, consumerId, channelId, alias): SetAliasResult // system-wide uniqueness gate (the ONE gate)
recalculate(reg): { registry, conflicts }                  // reassign all — deterministic, gapless, idempotent
// queries
addressOf(reg, consumerId, channelId): string | undefined
buildAliasIndex(reg): Map<alias, address>
resolveLocation(field, aliasIndex): string                 // compile-time: alias|literal -> address
```

`recalculate()` is **idempotent** (same input → same output) so it is safe
to call on every mutation, on project load, and pre-compile.

## 5. Allocation algorithm

1. **Reserve** every `pinned` channel at its literal address (pin-mapping,
   or any explicitly-fixed channel). Two pinned channels on the same
   address are reported as a conflict (first wins).
2. **Allocate** every non-pinned channel, walking consumers in `order`
   (ties broken by `id`) and channels in declaration order, taking the
   **lowest free index** in that channel's prefix space.
3. Bit prefixes (`%IX`/`%QX`/`%MX`) address as `byte.bit`
   (`linear = byte*8 + bit`); all other sizes are index-addressed.

Determinism (stable order + stable channel order) guarantees reproducible
results across sessions, so a re-open never gratuitously renumbers.

## 6. Aliases and variable binding

- **Aliases live only in the registry**, attached to channels. Uniqueness
  is enforced in the single `setAlias` gate — no producer can create a
  duplicate.
- **A program variable's location field holds either an alias name or a
  literal IEC address.** The compiler only understands IEC addresses, so
  the editor resolves at compile time (`resolveLocation`):
  - **alias** → the alias's current address from the registry;
  - **alias no longer exists** → empty location (variable is unlocated —
    this already matches today's orphan behavior);
  - **literal `%…`** → used **verbatim**.
- **Manual literal addresses are fully manual.** The allocator does **not**
  reserve or avoid them. If the user types `%QX0.3` and later reallocation
  assigns `%QX0.3` to some channel, that is the user's responsibility —
  we honor exactly what they typed. This keeps the manual escape hatch
  simple and predictable.
- Because aliases attach to the stable channel, moving `%QX0.3 → %QX0.5`
  updates `alias → address` automatically; every variable using that alias
  now resolves to `%QX0.5` with no user action. **That is the whole point:
  user code is address-agnostic.**

## 7. Migrate-on-open (existing projects → registry format)

Old projects store addresses and aliases scattered across producer records
and have no `addressRegistry` section. On project open, when the section is
absent, run a **one-shot pure migration**:

1. **Build consumers** from legacy producer state, one consumer per natural
   unit, preserving channel order:
   - `pin-mapping` → one pinned channel per board pin (alias from `pin.alias`).
   - `vpp-io` → one consumer per slot/module; channels from its
     `io-mapping` entries (class from `entry.iecAddress`, alias from
     `entry.alias`).
   - `modbus-tcp-remote` → one consumer per IO group; channels from
     `ioPoints` (class from function code, alias from `point.alias`).
   - `ethercat` → one consumer per slave; channels from `channelMappings`
     (alias from `mapping.alias`).
   Each channel's **initial `pinned` = its current legacy address**, so the
   first `recalculate()` reproduces exactly today's addresses (nothing
   moves on open).
2. **Adopt variables onto aliases.** For each program variable whose
   `location` matches an aliased channel address, rewrite `location` to the
   **alias name** (self-upgrade — today's `adopt`). Variables on a
   non-aliased address stay as manual literals; variables already using an
   alias are unchanged.
3. **Unpin.** After adoption, clear the temporary `pinned` seeds on the
   allocatable (non-hardware) channels so subsequent edits can compact
   gaps. Genuine hardware pins (pin-mapping) stay pinned.
4. **Strip** the now-migrated address/alias fields from producer records
   and write the `addressRegistry` section. Bump a project schema version
   so the migration runs exactly once.

The migration is a pure function `migrateProjectToRegistry(project)` with
its own exhaustive tests (round-trip: legacy project → registry →
addresses identical to the originals; aliases preserved; variables
adopted).

## 8. Compilation

At compile, the pipeline resolves each variable's location through
`resolveLocation(field, buildAliasIndex(registry))` and emits the concrete
`%…` (or an empty location, dropping the `AT %…`, when an alias orphaned).
Literals pass through unchanged. No producer-specific address logic remains
in the emitters.

## 9. Module layout (shared surface)

```
middleware/shared/utils/iec-address/registry/
  types.ts          # Consumer, Channel, AddressClass, IecAddressRegistry, reports
  address-space.ts  # prefix<->class, bit linearization, parse/format, lowest-free
  allocate.ts       # allocateAddresses(consumers) -> { assignments, conflicts }
  registry.ts       # createRegistry / add / remove / update / setAlias / recalculate / queries
  resolve.ts        # buildAliasIndex, resolveLocation (compile-time)
  migrate.ts        # migrateProjectToRegistry (legacy -> registry) [Phase 2]
  index.ts
frontend/store/slices/iec-address/   # Zustand slice wrapping the pure core [Phase 2]
```

The pure core carries no framework or Electron coupling and is
byte-identical across both repos. The old `address-pool.ts` /
`alias-registry.ts` / `sync-variable-aliases.ts` are removed once every
producer and the compiler have moved to the registry.

## 10. Phased delivery

- **Phase 1** — pure core (§3–§6 minus migration): types, address-space,
  allocator, registry ops, `resolveLocation`. Fully unit-tested. No wiring.
- **Phase 2** — `migrateProjectToRegistry` + the Zustand slice + wire into
  project load (schema-version gated).
- **Phase 3** — Modbus + EtherCAT register as consumers; delete their
  bespoke allocators. **Delivers project-wide gap reclamation (bug #4).**
- **Phase 4** — VPP registers as consumers (module-channel resolver
  injected); delete the two allocator effects.
- **Phase 5** — pin-mapping as pinned consumer; unify alias editing on the
  single `setAlias` gate.
- **Phase 6** — compiler resolves via the registry; delete the legacy
  pool/registry/sync modules and the now-redundant producer fields.

Each phase ships as a paired editor+web PR keeping the shared surface
byte-identical.

## 11. Implementation status

Shipped on `feat/central-iec-address-registry` (editor + web, byte-identical):

- **Pure core** — types, address-space, allocator (capability-scoped,
  gapless, deterministic), registry ops, `resolveLocation`, migration
  transform, and the session **alias-memory** (`memoryKey` +
  `restoreAliasesFromMemory`, keyed `moduleId:slot:channel`; held in the store,
  never serialized, reset on a fresh project).
- **Central action** `recalculateIecAddresses` reallocates **VPP + Modbus +
  EtherCAT** together (`ALLOCATED_KINDS`), capability-scoped, restoring aliases
  from the session memory, and writes addresses + aliases back to each
  producer (VPP `io-mapping`, Modbus `ioPoints`, EtherCAT `channelMappings`).
  Invoked from every producer mutation and on target switch.
- **Pins** participate as **fixed constraints** — hardware addresses are never
  reallocated; their aliases persist per-board and flow through the same
  registry uniqueness gate. Nothing to route.
- **Aliases** resolve to concrete IEC addresses **in the editor** (each
  variable's `location` is kept resolved); the compiler/runtime are untouched.

**Deliberately deferred** (superseded but still present; removal needs the
class-carrying-entry refactor + a `syncVariableAliases` migration, both best
verified in-app): the VPP effects' provisional `nextFreeAddress` seeding
(overwritten by the central recalc), the EtherCAT `esi-parser` overlap
allocator (superseded by the independent-prefix model — confirmed against the
runtime's separate typed buffers), and the legacy `address-pool` /
`alias-registry` read model (still backs `syncVariableAliases` and the
per-producer alias-uniqueness gates — consistent with the registry because
both derive from the same producer state).
