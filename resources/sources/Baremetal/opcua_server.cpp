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
#include <open62541_arduino.h>
#include <string.h>


#include "opcua_log.h"
#include "baremetal_net.h"
#include "opcua_auth.h"
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

/** Serve namespace zero from the library's const flash table.
 *
 *  Only valid against a library built with UA_NS0=NONE: in that configuration
 *  upstream expects an external nodestore to have namespace zero pre-loaded.
 *  Off by default so a MINIMAL library behaves exactly as before. Worth
 *  18,992 bytes of arena when on. */
#ifndef OPCUA_NS0_FROM_FLASH
#define OPCUA_NS0_FROM_FLASH true
#endif

/** Bytes carried from the socket into open62541 per read.
 *
 *  NOT the protocol's 8192 floor -- that is what the server must accept, and
 *  it is advertised through tcpBufSize below. open62541 accumulates a message
 *  spanning several reads into its own SecureChannel buffer, so this only has
 *  to make a read worthwhile. Typical OPC-UA requests are a few hundred bytes;
 *  a resident 8 KB pays constantly for the rare large one. */
#ifndef OPCUA_RECV_BUFFER
#define OPCUA_RECV_BUFFER 1024u
#endif

/** Max chunk length, both directions. Advertised in the Ack, and the size of
 *  the buffer allocated for every response.
 *
 *  8192 is the Part 6 6.7.1 floor and it is NOT adjustable, however tempting
 *  it looks: it is the single largest allocation the server makes, and
 *  lowering it was measured returning ERR 0x80020000 to a conformant Hello.
 *  open62541 enforces the floor itself in ua_securechannel.c, so a smaller
 *  value does not produce a smaller server -- it produces one no client can
 *  connect to. Left configurable only so the number has a name. */
#ifndef OPCUA_CHUNK_SIZE
#define OPCUA_CHUNK_SIZE 8192u
#endif
#ifndef OPCUA_SEND_BUFFER
#define OPCUA_SEND_BUFFER 2048u
#endif

// The library configuration and this flag have to agree, and the failure when
// they do not is silent: a NONE library with the flag off compiles cleanly and
// then serves an empty address space, because nothing ever built namespace
// zero. Catch it here instead.
#if !defined(UA_NAMESPACE_ZERO_MINIMAL) && !OPCUA_NS0_FROM_FLASH
#error "open62541 was built with UA_NAMESPACE_ZERO=NONE but OPCUA_NS0_FROM_FLASH is off: nothing would provide namespace zero."
#endif
#if defined(UA_NAMESPACE_ZERO_MINIMAL) && OPCUA_NS0_FROM_FLASH
#error "OPCUA_NS0_FROM_FLASH needs a library built with UA_NS0=NONE; a MINIMAL library builds namespace zero in RAM and ships no flash table."
#endif

namespace {

/** The server's heap.
 *
 *  Sized by the project's OPC-UA screen (OPCUA_ARENA_SIZE) and handed to the
 *  library at init. Static at file scope, so it is a link-time reservation:
 *  an over-budget project fails to link on the developer's machine rather
 *  than exhausting at runtime on the device. */
__attribute__((used)) alignas(8) uint8_t g_opcua_arena[OPCUA_ARENA_SIZE];

/** Our listening socket.
 *
 *  The library opens none: Arduino's `Server` base class is `begin()` and
 *  nothing else, so there is no portable accept and a library that owned the
 *  listener would need a table of board names. Owning it here is also what
 *  lets OPC-UA and S7Comm share one slot pool, which is a resource decision
 *  belonging to the product rather than to either protocol. */
bm_net::Listener g_listener(OPCUA_PORT, BM_NET_OPCUA_SLOTS);

/** The flash nodestore, so populate() can tell it our namespace index. */
UA_Nodestore* g_nodestore = nullptr;

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
    // ceiling we want: every response allocates one of these.
    //
    // Do not lower OPCUA_CHUNK_SIZE below 8192. Measured: the handshake then
    // fails with ERR 0x80020000, because open62541 enforces the Part 6 6.7.1
    // floor internally rather than merely advertising it. A smaller value
    // buys no memory, it just makes the server unreachable.
    config->tcpBufSize = OPCUA_CHUNK_SIZE;

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

    return config->tcpBufSize == OPCUA_CHUNK_SIZE
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

/** The flash nodestore, for opcua_nodes_populate() to bind our namespace to.
 *  A function rather than a shared global so the storage stays in one TU. */
UA_Nodestore* opcua_server_nodestore()
{
    return g_nodestore;
}

void opcua_init()
{
    if (g_started)
        return;

    // Hand the library its heap.
    //
    // The arena lives HERE, in generated-project scope, not in the library:
    // its size comes from the project's OPC-UA settings, and a library cannot
    // see a generated header -- arduino-cli does not put the sketch include
    // path on library compilation. Passing the buffer is also the reachable
    // reference that keeps it in .bss at all, --gc-sections having been
    // measured discarding a static array nothing demonstrably reads.
    UA_Arduino_setArena(g_opcua_arena, sizeof(g_opcua_arena));

    // Size the transport from the same settings, for the same reason.
    UA_Arduino_configureTcp(BM_NET_OPCUA_SLOTS, OPCUA_RECV_BUFFER);

    // The two things Arduino's abstract `Client` cannot answer, supplied by
    // the seam that does know: whether a write would block, and when a client
    // slot may go back to the shared pool.
    UA_Arduino_setCanSendCallback(
        [](Client* c, size_t n, void*) { return bm_net::can_send(c, n); }, nullptr);
    UA_Arduino_setClosedCallback(
        [](Client* c, void*) { bm_net::release(c); }, nullptr);

    if (!g_listener.begin())
    {
        OPCUA_LOG("[ua] listener begin FAILED on port %d", (int)OPCUA_PORT);
        return;
    }

    OPCUA_LOG("[ua] arena %lu bytes, allocator bound",
              (unsigned long)sizeof(g_opcua_arena));
    // Build the CONFIG before the server, not after.
    //
    // UA_Server_new() would construct namespace zero on the way out, so a
    // nodestore installed afterwards arrives too late to serve it. Configuring
    // first lets the flash nodestore be in place before any of that happens --
    // which is the whole point when namespace zero is const in flash.
    static UA_ServerConfig bootConfig;
    memset(&bootConfig, 0, sizeof(bootConfig));

    // The minimal config installs the EventLoop and the TCP ConnectionManager
    // through the factories the library supplies (the _POSIX-named forwarders).
    if (UA_ServerConfig_setMinimalCustomBuffer(&bootConfig, OPCUA_PORT, nullptr,
                                               OPCUA_CHUNK_SIZE, OPCUA_CHUNK_SIZE)
        != UA_STATUSCODE_GOOD)
    {
        OPCUA_LOG("[ua] setMinimalCustomBuffer FAILED");
        return;
    }

    // Namespace index 0 here means "not assigned yet" -- our own namespace
    // index is only known once the server has been created and
    // UA_Server_addNamespace() has returned it, so opcua_nodes_populate()
    // calls UA_Nodestore_flashSetNamespace() with it later.
    UA_Arduino_FlashNodeSource src;
    memset(&src, 0, sizeof(src));
    src.materialise = [](UA_UInt16 nsIdx, UA_UInt32 numericId,
                         UA_VariableNode* out, void*) -> bool {
        return opcua_nodes_materialise((UA_UInt16)numericId, nsIdx, out);
    };
    src.dematerialise = [](UA_VariableNode* node, void*) {
        opcua_nodes_dematerialise(node);
    };
    src.count = [](void*) -> UA_UInt16 { return opcua_nodes_count(); };
    src.idAt  = [](UA_UInt16 index, void*) -> UA_UInt32 {
        return (UA_UInt32)opcua_nodes_id_at(index);
    };
    src.namespaceIndex = 0;
    src.context        = nullptr;

    // Drop the default ziptree when namespace zero comes from flash: with
    // ns0 const and the project's own nodes const, it would hold nothing while
    // costing 2,640 bytes of arena. Freeing it here rather than handing it over
    // is the difference between an unused allocation and no allocation.
    UA_Nodestore* inner = bootConfig.nodestore;
    if (OPCUA_NS0_FROM_FLASH && inner != nullptr && inner->free != nullptr)
    {
        inner->free(inner);
        inner = nullptr;
    }
    UA_Nodestore* flash = UA_Nodestore_newFlash(&src, inner,
                                                bootConfig.logging,
                                                OPCUA_NODE_POOL_SLOTS,
                                                OPCUA_NS0_FROM_FLASH);
    if (flash == nullptr)
    {
        OPCUA_LOG("[ua] flash nodestore FAILED");
        return;
    }
    bootConfig.nodestore = flash;
    g_nodestore = flash;

    g_server = UA_Server_newWithConfig(&bootConfig);
    if (g_server == nullptr)
    {
        UA_Arduino_ArenaStats st; UA_Arduino_getArenaStats(&st);
        OPCUA_LOG("[ua] UA_Server_newWithConfig FAILED hw=%lu fail=%lu largest=%lu",
                  (unsigned long)st.highWater, (unsigned long)st.failures,
                  (unsigned long)st.largestFree);
        return;
    }
    {
        UA_Arduino_ArenaStats st; UA_Arduino_getArenaStats(&st);
        OPCUA_LOG("[ua] server ok  inuse=%lu hw=%lu", (unsigned long)st.inUse,
                  (unsigned long)st.highWater);
    }
    // From here on the SERVER's config is the live one.
    //
    // UA_Server_newWithConfig() copies the config in and then memsets the
    // caller's copy to zero -- it takes ownership. Continuing to use the local
    // one would mean configuring a zeroed struct: the first symptom was access
    // control refusing to install because securityPoliciesSize had become 0.
    UA_ServerConfig* config = UA_Server_getConfig(g_server);
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

    // Before run_startup: the endpoints advertise which user-token policies
    // the server accepts, and they are built during startup.
    if (opcua_auth_install(config) != UA_STATUSCODE_GOOD)
    {
        OPCUA_LOG("[auth] access control install FAILED");
        UA_Server_delete(g_server);
        g_server = nullptr;
        return;
    }

    if (opcua_nodes_populate(g_server, nullptr) != UA_STATUSCODE_GOOD)
    {
        UA_Server_delete(g_server);
        g_server = nullptr;
        return;
    }

    {
        UA_Arduino_ArenaStats st; UA_Arduino_getArenaStats(&st);
        OPCUA_LOG("[ua] nodes added (%d) inuse=%lu hw=%lu", (int)OPCUA_NODE_COUNT,
                  (unsigned long)st.inUse, (unsigned long)st.highWater);
    }

    UA_StatusCode startRc = UA_Server_run_startup(g_server);
    if (startRc != UA_STATUSCODE_GOOD)
    {
        UA_Server_delete(g_server);
        g_server = nullptr;
        return;
    }

    {
        UA_Arduino_ArenaStats st; UA_Arduino_getArenaStats(&st);
        OPCUA_LOG("[ua] run_startup rc=0x%08lx inuse=%lu hw=%lu largest=%lu",
                  (unsigned long)startRc, (unsigned long)st.inUse,
                  (unsigned long)st.highWater, (unsigned long)st.largestFree);
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
            UA_Arduino_ArenaStats st; UA_Arduino_getArenaStats(&st);
            OPCUA_LOG("[arena] inuse=%lu hw=%lu fail=%lu largest=%lu",
                      (unsigned long)st.inUse, (unsigned long)st.highWater,
                      (unsigned long)st.failures, (unsigned long)st.largestFree);
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
    // Accept before iterating. We own the listening socket (see g_listener);
    // the library only ever receives connected clients. One per pass keeps the
    // work bounded, and bm_net recycles slots whose peer has gone, so this
    // cannot run the table out.
    if (g_server != nullptr)
    {
        Client* incoming = g_listener.accept();
        if (incoming != nullptr &&
            UA_Arduino_acceptClient(incoming) != UA_STATUSCODE_GOOD)
        {
            // Server full. Closing now is the honest answer: the client
            // retries, whereas holding it consumes a slot for nothing.
            bm_net::release(incoming);
        }
    }

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
                  (unsigned long)({ UA_Arduino_ArenaStats _s; UA_Arduino_getArenaStats(&_s); _s.inUse; }));
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
