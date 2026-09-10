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

#include "opcua_arena.h"
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

bool     g_started = false;
uint32_t g_overruns = 0;

} // namespace

uint32_t opcua_overrun_count()
{
    return g_overruns;
}

void opcua_init()
{
    if (g_started)
        return;

    // Reset the arena. This is also the reachable reference that keeps the
    // arena in .bss at all — see the note in opcua_arena.cpp about
    // --gc-sections discarding a static array nothing demonstrably reads.
    opcua_arena_reset();


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


#endif // OPCUA_ENABLED
