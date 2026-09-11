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

#include <open62541.h>

#include "opcua_arena.h"
#include "opcua_log.h"
#include "opcua_arch.h"
#include "opcua_net.h"
#include "opcua_nodes.h"
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

bool       g_started  = false;
uint32_t   g_overruns = 0;
UA_Server* g_server   = nullptr;

/** Apply everything the VPP declared, then CHECK it.
 *
 *  The check is not paranoia. `UA_ServerConfig_setMinimalCustomBuffer` ignores
 *  its `sendBufferSize` argument outright — `ua_config_default.c` does
 *  `(void)sendBufferSize; config->tcpBufSize = recvBufferSize;` — so a caller
 *  can "set" a buffer size and have nothing happen. The shipped defaults are
 *  also nowhere near a microcontroller: 64 KB buffers per direction, 512 MB
 *  max message, 16k chunks, 100 sessions. Silently inheriting any of those
 *  would blow the arena, so anything that did not take effect is a hard
 *  failure here rather than a surprise in the field.
 */
bool apply_and_verify_limits(UA_ServerConfig* config)
{
    // Buffers. `tcpBufSize` is the max chunk length in BOTH directions —
    // open62541 exposes one value, not a pair, which is the same reason
    // UA_ServerConfig_setMinimalCustomBuffer ignores its sendBufferSize
    // argument. 8192 is the protocol floor (Part 6 6.7.1) and also the
    // ceiling we want: every session costs two of these.
    config->tcpBufSize = 8192;

    // Bound the receive-assembly path. BOTH of these default to 0, which
    // means UNBOUNDED: open62541 queues intermediate chunks and copies them
    // into one contiguous message, so a client could drive the arena to
    // exhaustion. One chunk per message turns that into a clean
    // Bad_TcpMessageTooLarge instead.
    config->tcpMaxMsgSize = 8192;
    config->tcpMaxChunks  = 1;

    config->maxSessions       = OPCUA_MAX_SESSIONS;
    config->maxSecureChannels = OPCUA_MAX_SESSIONS;

    // OperationLimits. Published under ServerCapabilities so conformant
    // clients split their own requests, and enforced so the rest get
    // Bad_TooManyOperations instead of a scan-cycle overrun.
    config->maxNodesPerRead      = OPCUA_MAX_NODES_PER_READ;
    config->maxNodesPerWrite     = OPCUA_MAX_NODES_PER_WRITE;
    config->maxNodesPerBrowse    = OPCUA_MAX_NODES_PER_BROWSE;
    config->maxReferencesPerNode = OPCUA_MAX_REFERENCES_PER_NODE;

    return config->tcpBufSize == 8192
        && config->tcpMaxMsgSize == 8192
        && config->tcpMaxChunks == 1
        && config->maxSessions == OPCUA_MAX_SESSIONS
        && config->maxNodesPerRead == OPCUA_MAX_NODES_PER_READ;
}

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

    // Point open62541's allocator at the arena BEFORE anything allocates.
    //
    // The library is built with UA_ENABLE_MALLOC_SINGLETON, so UA_malloc and
    // friends are function pointers rather than compile-time bindings to the
    // standard allocator. Setting them here is what actually makes the arena
    // the server's heap; without it the arena would be reserved, counted in
    // the budget, and never touched while open62541 allocated from the newlib
    // heap the user program shares.
    UA_mallocSingleton  = opcua_arena_malloc;
    UA_freeSingleton    = opcua_arena_free;
    UA_callocSingleton  = opcua_arena_calloc;
    UA_reallocSingleton = opcua_arena_realloc;

    OPCUA_LOG("[ua] arena reset, allocator bound");
    g_server = UA_Server_new();
    if (g_server == nullptr)
    {
        opcua_arena_stats_t st; opcua_arena_get_stats(&st);
        OPCUA_LOG("[ua] UA_Server_new FAILED hw=%lu fail=%lu largest=%lu",
                  (unsigned long)st.high_water, (unsigned long)st.failures,
                  (unsigned long)st.largest_free);
        return;
    }
    {
        opcua_arena_stats_t st; opcua_arena_get_stats(&st);
        OPCUA_LOG("[ua] UA_Server_new ok  inuse=%lu hw=%lu", (unsigned long)st.in_use,
                  (unsigned long)st.high_water);
    }

    UA_ServerConfig* config = UA_Server_getConfig(g_server);

    // Minimal config first: it installs the EventLoop and the TCP
    // ConnectionManager through the factories our arch layer supplies (the
    // _POSIX-named forwarders — see opcua_arch.cpp).
    if (UA_ServerConfig_setMinimalCustomBuffer(config, OPCUA_PORT, nullptr, 8192, 8192)
        != UA_STATUSCODE_GOOD)
    {
        OPCUA_LOG("[ua] setMinimalCustomBuffer FAILED");
        UA_Server_delete(g_server);
        g_server = nullptr;
        return;
    }
    OPCUA_LOG("[ua] config set");

    if (!apply_and_verify_limits(config))
    {
        // A limit that did not stick means the arena budget is not what the
        // VPP declared. Refusing to start is the honest outcome.
        UA_Server_delete(g_server);
        g_server = nullptr;
        return;
    }

    OPCUA_LOG("[ua] limits ok buf=%lu maxmsg=%lu chunks=%lu sessions=%u",
              (unsigned long)config->tcpBufSize, (unsigned long)config->tcpMaxMsgSize,
              (unsigned long)config->tcpMaxChunks, (unsigned)config->maxSessions);

    if (opcua_nodes_populate(g_server, nullptr) != UA_STATUSCODE_GOOD)
    {
        UA_Server_delete(g_server);
        g_server = nullptr;
        return;
    }

    {
        opcua_arena_stats_t st; opcua_arena_get_stats(&st);
        OPCUA_LOG("[ua] nodes added (%d) inuse=%lu hw=%lu", (int)OPCUA_NODE_COUNT,
                  (unsigned long)st.in_use, (unsigned long)st.high_water);
    }

    UA_StatusCode startRc = UA_Server_run_startup(g_server);
    if (startRc != UA_STATUSCODE_GOOD)
    {
        UA_Server_delete(g_server);
        g_server = nullptr;
        return;
    }

    {
        opcua_arena_stats_t st; opcua_arena_get_stats(&st);
        OPCUA_LOG("[ua] run_startup rc=0x%08lx inuse=%lu hw=%lu largest=%lu",
                  (unsigned long)startRc, (unsigned long)st.in_use,
                  (unsigned long)st.high_water, (unsigned long)st.largest_free);
    }
    g_started = true;
    OPCUA_LOG("[ua] LISTENING on %d", (int)OPCUA_PORT);
}

void opcuatask()
{
    // Before the g_started guard, deliberately: the debug log is most needed
    // exactly when init FAILED, and servicing it only on the happy path is
    // how the first bring-up attempt produced an open port 23 and no output.
    opcua_log_poll();

    if (!g_started)
        return;

    const unsigned long deadline = micros() + OPCUA_SCAN_BUDGET_US;

    // Non-blocking by construction: our EventLoop's run() ignores the timeout
    // because sleeping here would stop the PLC logic. One iterate per scan;
    // pending work waits for the next one.
    if (g_server != nullptr)
        UA_Server_run_iterate(g_server, 0);

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
