/*
opcua_server.cpp - baremetal OPC-UA server
Copyright (C) 2026 Autonomy Logic

STATUS: skeleton.  The address space, the network seam and the scan-loop
integration are in place and build on every target; the open62541 core is not
wired in yet (it needs the cross-compiled `libopen62541.a` and the
`arch/arduino` EventLoop + ConnectionManager, tracked separately).  Until then
`opcuatask()` accepts and politely closes connections, which is enough to prove
the seam, the time-box and the generated configuration end to end without the
library present.

Design notes that outlive the skeleton:

  - Values are never cached.  A read goes straight to
    `strucpp::debug::handle_read(arr, elem, …)` against the table the compiler
    emitted, so there is no shadow copy to keep in sync and no mirroring loop
    at scan rate.  `OPCUA_NODES[]` carries the coordinates; that is the whole
    data plane.
  - The address space lives in flash.  `OPCUA_NODES[]` is `const`, and nodes
    are materialised into a small fixed pool on demand, so per-node RAM is
    bounded by how many nodes are held at once (which the operation limits
    bound) rather than by how many exist.
  - All dynamic allocation goes through one static arena, so the server cannot
    compete with the user program for the heap or fragment it over months of
    uptime.
*/

#include "opcua_server.h"

#if OPCUA_ENABLED

#include "opcua_net.h"
#include "opcua_types.h"

// The generated header instantiates OPCUA_NODES[] / OPCUA_USERS[] against the
// records in opcua_types.h, so it must come after it.
#include "opcua_config.h"

/** Microseconds of each scan cycle the server may consume.  Declared here
 *  rather than in the generated header because it is a runtime scheduling
 *  policy, not project configuration. */
#ifndef OPCUA_SCAN_BUDGET_US
#define OPCUA_SCAN_BUDGET_US 1000u
#endif

namespace {

/** The arena every OPC-UA allocation comes from.
 *
 *  A fixed array is the point: it makes the server's footprint a link-time
 *  fact (an overflow is an `arduino-cli` error in the same line the user
 *  already reads, not a field failure), it cannot fragment the newlib heap the
 *  user program allocates from, and it caps the feature by construction
 *  instead of by hope.
 *
 *  `used` is load-bearing, not decoration.  The core builds with
 *  `-fdata-sections` and links with `--gc-sections`, and until the allocator
 *  lands nothing READS this array — so the optimiser drops the initialising
 *  store as dead, the array becomes unreferenced, and the linker discards the
 *  whole 32 KB.  That was the observed behaviour: the OPC-UA layer linked and
 *  the arena did not appear in `.bss` at all, which would have let an
 *  over-budget configuration build cleanly and only fail on the device — the
 *  exact failure this arena exists to make impossible. */
__attribute__((used)) uint8_t g_arena[OPCUA_ARENA_SIZE];

bool     g_started = false;
uint32_t g_overruns = 0;

} // namespace

/** Base of the OPC-UA arena.
 *
 *  External linkage so the allocator (and, right now, the linker) has a real
 *  reference to the storage rather than relying on an attribute alone. */
uint8_t* opcua_arena_base()
{
    return g_arena;
}

size_t opcua_arena_size()
{
    return sizeof(g_arena);
}

uint32_t opcua_overrun_count()
{
    return g_overruns;
}

void opcua_init()
{
    if (g_started)
        return;

    // Reserve the arena, for real.
    //
    // This looks like a no-op and is not.  The core builds with
    // `-fdata-sections` / `--gc-sections`, and until the allocator lands
    // nothing reads `g_arena`.  `__attribute__((used))` only stops the
    // COMPILER from dropping it; the LINKER's gc-sections pass still discards
    // it (and `retain` is GCC 11+, while this toolchain is 8.3).  Measured:
    // without a reference from a reachable path the whole 32 KB vanished from
    // `.bss` — an over-budget configuration would have linked cleanly and
    // failed only on the device, which is precisely what the arena exists to
    // prevent.  `opcua_init()` is called from Baremetal.ino, so a volatile
    // touch here is a reference the optimiser cannot elide and gc-sections
    // cannot follow past.  It goes away when the allocator starts using the
    // arena in earnest.
    volatile uint8_t* arena_probe = g_arena;
    *arena_probe = 0;

    if (!opcua_net::begin(OPCUA_PORT))
        return;

    g_started = true;
}

void opcuatask()
{
    if (!g_started)
        return;

    const unsigned long deadline = micros() + OPCUA_SCAN_BUDGET_US;

    opcua_net::poll();

    // Skeleton: accept and close.  This is deliberately not a stub that does
    // nothing — accepting proves the listener is bound, the slot table
    // recycles, and the time-box holds, all of which are the parts that
    // interact with the scan loop and are therefore worth having under test
    // before the library lands.
    Client* incoming = opcua_net::accept();
    if (incoming != nullptr)
        opcua_net::release(incoming);

    // Signed comparison so the wrap of micros() (every ~71 minutes) reads as
    // a small negative rather than a huge positive, which would otherwise
    // record a spurious overrun once an hour.
    if ((long)(micros() - deadline) > 0)
        g_overruns++;
}

#else // !OPCUA_ENABLED

// Empty translation unit on targets without an OPC-UA server. The facade is
// still defined so Baremetal.ino needs no #ifdef around the call site — one
// less place for a board-conditional to accumulate.
void opcua_init() {}
void opcuatask() {}
uint32_t opcua_overrun_count() { return 0; }
// No arena on a target with no server — nothing allocates, so nothing is
// reserved. Returning null/0 rather than omitting these keeps the header one
// declaration set for both cases.
uint8_t* opcua_arena_base() { return nullptr; }
size_t opcua_arena_size() { return 0; }

#endif // OPCUA_ENABLED
