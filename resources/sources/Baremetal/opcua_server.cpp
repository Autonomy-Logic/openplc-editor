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
/** The longest the server may go unserviced, from the project's OPC-UA screen
 *  (`cycleTimeMs`). Fallback only matters for a hand-written config.h. */
#ifndef OPCUA_SYNC_INTERVAL_MS
#define OPCUA_SYNC_INTERVAL_MS 100u
#endif

/** What one UA_Server_run_iterate() may cost in the worst case.
 *
 *  Not a budget that gets enforced mid-call -- there is no way to interrupt
 *  open62541 -- but the admission threshold: with less slack than this left in
 *  the cycle, the server is not run at all. Measured worst case on a LOGO! 8.2
 *  under sustained load is 4,816 us (session establishment, whose response is
 *  by far the largest message the server ever encodes), so this carries margin
 *  over it rather than tracking it exactly. */
#ifndef OPCUA_WORST_CASE_US
#define OPCUA_WORST_CASE_US 6000u
#endif

#ifndef OPCUA_SCAN_BUDGET_US
#define OPCUA_SCAN_BUDGET_US 1000u
#endif

namespace {

bool       g_started  = false;
uint32_t   g_overruns = 0;
/* Worst and total time opcuatask() has spent inside UA_Server_run_iterate.
 * The overrun COUNT alone cannot answer "by how much" -- a budget missed by
 * 10 us and one missed by 10 ms are the same event to it, and only the second
 * threatens a 20 ms scan. */
uint32_t   g_max_us   = 0;
uint32_t   g_calls    = 0;
/* Scans in which there was not enough slack to run at all. A large number here
 * is not a fault -- it is the PLC keeping its cycle, which is the priority --
 * but it does mean OPC-UA is being starved and the scan interval is too tight
 * for the two to coexist comfortably. Worth surfacing to the user. */
uint32_t   g_skipped  = 0;
/* Iterations that ran because the sync interval came due rather than because
 * there was slack. A high ratio of forced to total means the scan interval is
 * too tight to absorb OPC-UA opportunistically -- useful to surface, not a
 * fault in itself. */
uint32_t   g_forced   = 0;
unsigned long g_next_due_ms = 0;
uint64_t   g_total_us = 0;
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

    config->maxSessions = OPCUA_MAX_SESSIONS;

    // SecureChannels are NOT sessions, and tying them together was a mistake.
    //
    // A session costs two 8 KB buffers, which is why maxSessions is the
    // expensive, VPP-declared dimension. A SecureChannel is a small
    // bookkeeping struct — but a CLOSED channel lingers until housekeeping
    // reaps it, so allowing exactly as many channels as sessions means the
    // next client is refused for as long as the previous one's channel is
    // still being torn down. Measured on hardware as strictly alternating
    // connect failures: one good session, one BadInternalError, repeating.
    //
    // Headroom here costs bytes, not buffers.
    config->maxSecureChannels = OPCUA_MAX_SESSIONS + 3;

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
        && config->maxSecureChannels == OPCUA_MAX_SESSIONS + 3
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

    OPCUA_LOG("[ua] limits ok buf=%lu maxmsg=%lu chunks=%lu sessions=%u channels=%u",
              (unsigned long)config->tcpBufSize, (unsigned long)config->tcpMaxMsgSize,
              (unsigned long)config->tcpMaxChunks, (unsigned)config->maxSessions,
              (unsigned)config->maxSecureChannels);

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

void opcuatask(uint32_t slack_us)
{
    // Before the g_started guard, deliberately: the debug log is most needed
    // exactly when init FAILED, and servicing it only on the happy path is
    // how the first bring-up attempt produced an open port 23 and no output.
    opcua_log_poll();

    // Periodic net/arena census. Cheap (a few integer reads) and it is the
    // only way to see a slow leak: a one-shot dump after a failure cannot
    // distinguish "exhausted gradually" from "exhausted at the moment of
    // failure", and those have different fixes.
    {
        static unsigned long s_next = 0;
        const unsigned long now_ms = millis();
        if ((long)(now_ms - s_next) >= 0)
        {
            s_next = now_ms + 15000;
            opcua_log_netstats("tick");
            opcua_arena_stats_t st; opcua_arena_get_stats(&st);
            OPCUA_LOG("[arena] inuse=%lu hw=%lu fail=%lu largest=%lu",
                      (unsigned long)st.in_use, (unsigned long)st.high_water,
                      (unsigned long)st.failures, (unsigned long)st.largest_free);
            OPCUA_LOG("[scan] budget=%luus overruns=%lu max=%luus avg=%luus calls=%lu",
                      (unsigned long)OPCUA_SCAN_BUDGET_US, (unsigned long)g_overruns,
                      (unsigned long)g_max_us,
                      (unsigned long)(g_calls ? (g_total_us / g_calls) : 0),
                      (unsigned long)g_calls);
            OPCUA_LOG("[scan] skipped=%lu forced=%lu sync=%lums",
                      (unsigned long)g_skipped, (unsigned long)g_forced,
                      (unsigned long)OPCUA_SYNC_INTERVAL_MS);
        }
    }

    if (!g_started)
        return;

    // Guaranteed service, plus opportunistic service. The same shape Modbus
    // has: it runs once per scan cycle come what may, and again whenever there
    // is room.
    //
    // A pure slack gate was WRONG and briefly shipped here. On a scan interval
    // short enough that the PLC logic and Modbus consume most of it, the slack
    // test never passes and the server is starved FOREVER -- it does not
    // degrade, it stops. Worse, the tighter the cycle the more completely it
    // fails, which is exactly backwards from a graceful limit.
    //
    // So slack only decides whether to run EARLY. Once OPCUA_SYNC_INTERVAL_MS
    // has elapsed the server runs regardless, because a scan cycle that cannot
    // afford ~5 ms of OPC-UA once per sync interval is a project whose scan
    // interval is mis-set, and the honest answer to that is a visible overrun
    // count, not a silently dead protocol.
    const unsigned long now_ms = millis();
    const bool due = (long)(now_ms - g_next_due_ms) >= 0;
    if (!due && slack_us < OPCUA_WORST_CASE_US)
    {
        g_skipped++;
        return;   // not due yet, and no room to get ahead
    }
    g_next_due_ms = now_ms + OPCUA_SYNC_INTERVAL_MS;
    if (due)
        g_forced++;

    const unsigned long deadline = micros() + OPCUA_SCAN_BUDGET_US;

    // Non-blocking by construction: our EventLoop's run() ignores the timeout
    // because sleeping here would stop the PLC logic. One iterate per scan;
    // pending work waits for the next one.
    const unsigned long t0 = micros();
    if (g_server != nullptr)
        UA_Server_run_iterate(g_server, 0);
    const unsigned long t1 = micros();
    const uint32_t spent = (uint32_t)(t1 - t0);
    // Catch a pathological iteration in the act. A 20 ms cycle cannot absorb
    // anything near this, so if it is real we need to see what it was doing;
    // and if it is a micros() discontinuity rather than real work, the raw
    // endpoints will say so.
    if (spent > 50000u)
        OPCUA_LOG("[scan] SPIKE %luus  t0=%lu t1=%lu arena_inuse=%lu",
                  (unsigned long)spent, (unsigned long)t0, (unsigned long)t1,
                  (unsigned long)({ opcua_arena_stats_t _s; opcua_arena_get_stats(&_s); _s.in_use; }));
    if (spent > g_max_us)
        g_max_us = spent;
    g_total_us += spent;
    g_calls++;

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
void opcuatask(uint32_t) {}
uint32_t opcua_overrun_count() { return 0; }


#endif // OPCUA_ENABLED
