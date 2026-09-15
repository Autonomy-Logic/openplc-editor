/*
opcua_server.cpp - baremetal OPC-UA server
Copyright (C) 2026 Autonomy Logic

STATUS: skeleton. The address space, network seam and scan-loop integration are
in place on every target; the open62541 core is not wired in yet. Until then
opcuatask() accepts and politely closes connections.

Values are never cached: a read goes straight to strucpp::debug::handle_read()
against the compiler's table, with OPCUA_NODES[] carrying the coordinates.
OPCUA_NODES[] is const in flash and nodes are materialised into a small fixed
pool on demand. All dynamic allocation goes through one static arena.
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

/** The longest the server may go unserviced, from the project's OPC-UA screen
 *  (`cycleTimeMs`). Fallback only matters for a hand-written config.h. */
#ifndef OPCUA_SYNC_INTERVAL_MS
#define OPCUA_SYNC_INTERVAL_MS 100u
#endif

/** Admission threshold: with less slack than this left in the cycle, the server
 *  is not run at all. Carries margin over the measured worst case, which is
 *  session establishment. */
#ifndef OPCUA_WORST_CASE_US
#define OPCUA_WORST_CASE_US 6000u
#endif

#ifndef OPCUA_SCAN_BUDGET_US
#define OPCUA_SCAN_BUDGET_US 1000u
#endif

/** Serve namespace zero from the library's const flash table. Only valid against
 *  a library built with UA_NS0=NONE, which expects an external nodestore to have
 *  namespace zero pre-loaded. Saves ~19 KB of arena. */
#ifndef OPCUA_NS0_FROM_FLASH
#define OPCUA_NS0_FROM_FLASH true
#endif

/** Bytes carried from the socket into open62541 per read. Not the protocol's
 *  8192 floor -- that is advertised through tcpBufSize below. open62541
 *  accumulates a multi-read message into its own SecureChannel buffer. */
#ifndef OPCUA_RECV_BUFFER
#define OPCUA_RECV_BUFFER 1024u
#endif

/** Max chunk length, both directions. Advertised in the Ack, and the size of the
 *  buffer allocated for every response.
 *
 *  8192 is the Part 6 6.7.1 floor and is not adjustable: open62541 enforces it
 *  in ua_securechannel.c, so a smaller value returns ERR 0x80020000 to a
 *  conformant Hello rather than producing a smaller server. */
#ifndef OPCUA_CHUNK_SIZE
#define OPCUA_CHUNK_SIZE 8192u
#endif
#ifndef OPCUA_SEND_BUFFER
#define OPCUA_SEND_BUFFER 2048u
#endif

// The library configuration and this flag have to agree, and the failure when
// they do not is silent: a NONE library with the flag off serves an empty
// address space. Catch it here instead.
#if !defined(UA_NAMESPACE_ZERO_MINIMAL) && !OPCUA_NS0_FROM_FLASH
#error "open62541 was built with UA_NAMESPACE_ZERO=NONE but OPCUA_NS0_FROM_FLASH is off: nothing would provide namespace zero."
#endif
#if defined(UA_NAMESPACE_ZERO_MINIMAL) && OPCUA_NS0_FROM_FLASH
#error "OPCUA_NS0_FROM_FLASH needs a library built with UA_NS0=NONE; a MINIMAL library builds namespace zero in RAM and ships no flash table."
#endif

namespace {

/** The server's heap, sized by OPCUA_ARENA_SIZE from the project's OPC-UA
 *  screen. Static at file scope, so an over-budget project fails to link rather
 *  than exhausting at runtime. */
__attribute__((used)) alignas(8) uint8_t g_opcua_arena[OPCUA_ARENA_SIZE];

/** Our listening socket. The library opens none: Arduino's `Server` base class
 *  has no portable accept. Owning it here also lets OPC-UA and S7Comm share one
 *  slot pool. */
bm_net::Listener g_listener(OPCUA_PORT, BM_NET_OPCUA_SLOTS);

/** The flash nodestore, so populate() can tell it our namespace index. */
UA_Nodestore* g_nodestore = nullptr;

bool       g_started  = false;
uint32_t   g_overruns = 0;
/* Worst and total time spent inside UA_Server_run_iterate; the overrun count
 * alone cannot answer "by how much". */
uint32_t   g_max_us   = 0;
uint32_t   g_calls    = 0;
/* Scans with too little slack to run at all. Not a fault, but it means OPC-UA is
 * being starved by a scan interval too tight for the two to coexist. */
uint32_t   g_skipped  = 0;
/* Iterations that ran because the sync interval came due rather than because
 * there was slack. */
uint32_t   g_forced   = 0;
unsigned long g_next_due_ms = 0;
uint64_t   g_total_us = 0;
UA_Server* g_server   = nullptr;

/** Apply everything the VPP declared, then check it.
 *
 *  `UA_ServerConfig_setMinimalCustomBuffer` ignores its `sendBufferSize`
 *  argument outright, and the shipped defaults (64 KB buffers, 512 MB max
 *  message, 16k chunks, 100 sessions) would blow the arena, so anything that did
 *  not take effect is a hard failure here. */
bool apply_and_verify_limits(UA_ServerConfig* config)
{
    // `tcpBufSize` is the max chunk length in BOTH directions -- open62541
    // exposes one value, not a pair. 8192 is the protocol floor (Part 6 6.7.1)
    // and also the ceiling we want: every response allocates one of these.
    config->tcpBufSize = OPCUA_CHUNK_SIZE;

    // Bound the receive-assembly path. Both of these default to 0, meaning
    // unbounded, so a client could drive the arena to exhaustion; one chunk per
    // message turns that into a clean Bad_TcpMessageTooLarge.
    config->tcpMaxMsgSize = 8192;
    config->tcpMaxChunks  = 1;

    config->maxSessions = OPCUA_MAX_SESSIONS;

    // SecureChannels are not sessions. A session costs two 8 KB buffers, but a
    // closed SecureChannel lingers until housekeeping reaps it, so allowing
    // exactly as many channels as sessions refuses the next client while the
    // previous one is torn down. Headroom here costs bytes, not buffers.
    config->maxSecureChannels = OPCUA_MAX_SESSIONS + 3;

    // OperationLimits. Published under ServerCapabilities so conformant clients
    // split their own requests, and enforced so the rest get
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

    // Hand the library its heap. The arena lives here, in generated-project
    // scope, because its size comes from the project's OPC-UA settings and
    // arduino-cli does not put the sketch include path on library compilation.
    // Passing the buffer is also what keeps it in .bss under --gc-sections.
    UA_Arduino_setArena(g_opcua_arena, sizeof(g_opcua_arena));

    // Size the transport from the same settings, for the same reason.
    UA_Arduino_configureTcp(BM_NET_OPCUA_SLOTS, OPCUA_RECV_BUFFER);

    // The two things Arduino's abstract `Client` cannot answer: whether a write
    // would block, and when a client slot may return to the shared pool.
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
    // Build the config before the server: UA_Server_new() would construct
    // namespace zero on the way out, so a nodestore installed afterwards arrives
    // too late to serve it.
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

    // Namespace index 0 here means "not assigned yet": our own index is only
    // known once UA_Server_addNamespace() has returned it, so
    // opcua_nodes_populate() calls UA_Nodestore_flashSetNamespace() later.
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

    // Drop the default ziptree when namespace zero comes from flash: it would
    // hold nothing while costing 2,640 bytes of arena.
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
    // From here on the SERVER's config is the live one:
    // UA_Server_newWithConfig() copies the config in and memsets the caller's
    // copy to zero, so continuing to use the local one configures a zeroed struct.
    UA_ServerConfig* config = UA_Server_getConfig(g_server);
    OPCUA_LOG("[ua] config set");

    if (!apply_and_verify_limits(config))
    {
        // A limit that did not stick means the arena budget is not what the VPP
        // declared, so refuse to start.
        UA_Server_delete(g_server);
        g_server = nullptr;
        return;
    }

    OPCUA_LOG("[ua] limits ok buf=%lu maxmsg=%lu chunks=%lu sessions=%u channels=%u",
              (unsigned long)config->tcpBufSize, (unsigned long)config->tcpMaxMsgSize,
              (unsigned long)config->tcpMaxChunks, (unsigned)config->maxSessions,
              (unsigned)config->maxSecureChannels);

    // Before run_startup: the endpoints advertise which user-token policies the
    // server accepts, and they are built during startup.
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
    // exactly when init failed.
    opcua_log_poll();

    // Periodic net/arena census, the only way to see a slow leak: a one-shot
    // dump after a failure cannot distinguish gradual exhaustion from sudden.
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

    // Guaranteed service plus opportunistic service, the same shape Modbus has.
    // A pure slack gate starves the server forever on a tight scan interval, so
    // slack only decides whether to run EARLY: once OPCUA_SYNC_INTERVAL_MS has
    // elapsed the server runs regardless and an overrun is reported.
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

    // Non-blocking by construction: our EventLoop's run() ignores the timeout,
    // because sleeping here would stop the PLC logic. One iterate per scan.
    // Accept before iterating: we own the listening socket and the library only
    // ever receives connected clients.
    if (g_server != nullptr)
    {
        Client* incoming = g_listener.accept();
        if (incoming != nullptr &&
            UA_Arduino_acceptClient(incoming) != UA_STATUSCODE_GOOD)
        {
            // Server full. Closing now makes the client retry, whereas holding
            // it consumes a slot for nothing.
            bm_net::release(incoming);
        }
    }

    const unsigned long t0 = micros();
    if (g_server != nullptr)
        UA_Server_run_iterate(g_server, 0);
    const unsigned long t1 = micros();
    const uint32_t spent = (uint32_t)(t1 - t0);
    // Catch a pathological iteration in the act: a 20 ms cycle cannot absorb
    // anything near this, and the raw endpoints distinguish real work from a
    // micros() discontinuity.
    if (spent > 50000u)
        OPCUA_LOG("[scan] SPIKE %luus  t0=%lu t1=%lu arena_inuse=%lu",
                  (unsigned long)spent, (unsigned long)t0, (unsigned long)t1,
                  (unsigned long)({ UA_Arduino_ArenaStats _s; UA_Arduino_getArenaStats(&_s); _s.inUse; }));
    if (spent > g_max_us)
        g_max_us = spent;
    g_total_us += spent;
    g_calls++;

    // Signed comparison so the wrap of micros() (every ~71 minutes) reads as a
    // small negative rather than recording a spurious overrun once an hour.
    if ((long)(micros() - deadline) > 0)
        g_overruns++;
}

#else // !OPCUA_ENABLED

// Empty translation unit on targets without an OPC-UA server. The facade is
// still defined so Baremetal.ino needs no #ifdef around the call site.
void opcua_init() {}
void opcuatask(uint32_t) {}
uint32_t opcua_overrun_count() { return 0; }


#endif // OPCUA_ENABLED
