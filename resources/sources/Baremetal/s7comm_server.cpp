/*
s7comm_server.cpp - Siemens S7Comm server for the baremetal runtime
Copyright (C) 2026 Autonomy Logic

S7 over ISO-TCP (RFC 1006), TCP port 102. The Settimino S7Server library owns the
protocol engine; this file owns the sockets, per-connection state, scan-cycle
scheduling and the bridge from S7 areas to located variables. Classic S7 has no
authentication or encryption.
*/

#include "s7comm_server.h"

#if S7COMM_ENABLED

#include <Arduino.h>
#include <string.h>

#include <S7Server.h>

#include "baremetal_net.h"
#include "opcua_log.h"       // shared debug transport
#include "s7comm_types.h"
#include "arduino_runtime_glue.h"
#include "openplc.h"         // located-variable buffers: bool_input[][], int_memory[], ...
// Tunables the generated config may override.
// ---------------------------------------------------------------------------
/** How often the server must run regardless of scan-cycle slack. */
#ifndef S7COMM_SYNC_INTERVAL_MS
#define S7COMM_SYNC_INTERVAL_MS 100u
#endif

/** Time one service pass may spend before it is counted as an overrun. */
#ifndef S7COMM_SCAN_BUDGET_US
#define S7COMM_SCAN_BUDGET_US 3000u
#endif

/** Slack required to admit a pass early; conservative until measured. */
#ifndef S7COMM_WORST_CASE_US
#define S7COMM_WORST_CASE_US 1500u
#endif

namespace {

// Storage: all static and sized at compile time, so memory use does not depend
// on what a peer does.

bm_net::Listener g_listener(S7COMM_PORT, BM_NET_S7_SLOTS);

S7Server g_server;
bool     g_started = false;

/** The library's view of the address space, built once at init from S7COMM_AREAS[].
 *  s7comm_area_t is the ABI with the code generator; S7SrvArea is the library's. */
S7SrvArea g_lib_areas[S7COMM_AREA_COUNT];

/** One connection. rx accumulates a frame, tx holds the reply; both are sized
 *  from the negotiated PDU ceiling. */
struct Conn
{
    Client*      client;
    S7SrvSession session;
    uint16_t     have;      // bytes of a frame accumulated so far
    uint8_t      rx[S7ISO_HEADER_SIZE + S7COMM_PDU_SIZE];
    uint8_t      tx[S7ISO_HEADER_SIZE + S7COMM_PDU_SIZE];
};

Conn g_conns[S7COMM_MAX_CLIENTS];

/** Round-robin cursor, so a chatty client cannot starve a quiet one. */
uint8_t g_cursor = 0;

// Scheduling state
unsigned long g_next_due_ms = 0;

// Counters.
uint32_t g_overruns = 0;
uint32_t g_max_us   = 0;
uint32_t g_total_us = 0;
uint32_t g_calls    = 0;
uint32_t g_skipped  = 0;
uint32_t g_forced   = 0;
uint32_t g_accepts  = 0;
uint32_t g_refused  = 0;

// ---------------------------------------------------------------------------
// The address space. Flash-resident and fixed at build time; the generated
// s7comm_config.h defines S7COMM_AREAS[].
// ---------------------------------------------------------------------------

/** Find the area a request names. Linear: the table is a handful of entries. */
const s7comm_area_t* find_area(uint8_t area, uint16_t dbNumber)
{
    for (uint8_t i = 0; i < S7COMM_AREA_COUNT; i++)
    {
        const s7comm_area_t* a = &S7COMM_AREAS[i];
        if (a->area != area)
            continue;
        if (area == S7COMM_AREA_DB && a->db_number != dbNumber)
            continue;
        return a;
    }
    return nullptr;
}

// The bridge from S7 areas to the PLC's located variables. An S7 area is a flat
// run of bytes; located variables are arrays of pointers into the program's
// storage, so every access translates an S7 byte offset into slot + byte within
// slot and flips byte order (S7 is big-endian, the targets little-endian). An
// unbound variable is a NULL pointer: reads give 0, writes are dropped.

/** Pointer to located slot `index` of `buffer`, or NULL if unbound or out of
 *  range. Ceilings come from openplc.h and differ per target. */
static void* slot_ptr(uint8_t buffer, uint16_t index, uint8_t* width)
{
    switch (buffer)
    {
        case S7COMM_BUF_INT_INPUT:
            *width = 2;
            return (index < MAX_ANALOG_INPUT) ? (void*)int_input[index] : NULL;
        case S7COMM_BUF_INT_OUTPUT:
            *width = 2;
            return (index < MAX_ANALOG_OUTPUT) ? (void*)int_output[index] : NULL;
#if defined(MAX_MEMORY_WORD) && MAX_MEMORY_WORD > 0
        case S7COMM_BUF_INT_MEMORY:
            *width = 2;
            return (index < MAX_MEMORY_WORD) ? (void*)int_memory[index] : NULL;
#endif
#if defined(MAX_MEMORY_DWORD) && MAX_MEMORY_DWORD > 0
        case S7COMM_BUF_DINT_MEMORY:
            *width = 4;
            return (index < MAX_MEMORY_DWORD) ? (void*)dint_memory[index] : NULL;
#endif
#if defined(MAX_MEMORY_LWORD) && MAX_MEMORY_LWORD > 0
        case S7COMM_BUF_LINT_MEMORY:
            *width = 8;
            return (index < MAX_MEMORY_LWORD) ? (void*)lint_memory[index] : NULL;
#endif
        default:
            *width = 0;
            return NULL;
    }
}

/** One bit of a bit buffer, or NULL. */
static IEC_BOOL* bit_ptr(uint8_t buffer, uint16_t byteIndex, uint8_t bitIndex)
{
    if (bitIndex > 7)
        return NULL;
    if (buffer == S7COMM_BUF_BOOL_INPUT)
        return (byteIndex < (MAX_DIGITAL_INPUT / 8)) ? bool_input[byteIndex][bitIndex] : NULL;
    if (buffer == S7COMM_BUF_BOOL_OUTPUT)
        return (byteIndex < (MAX_DIGITAL_OUTPUT / 8)) ? bool_output[byteIndex][bitIndex] : NULL;
    return NULL;
}

/** Read a slot as a native 64-bit value, widening from its real width. */
static uint64_t slot_read(void* p, uint8_t width)
{
    if (p == NULL)
        return 0;
    switch (width)
    {
        case 2:  return *(const uint16_t*)p;
        case 4:  return *(const uint32_t*)p;
        case 8:  return *(const uint64_t*)p;
        default: return 0;
    }
}

static void slot_write(void* p, uint8_t width, uint64_t value)
{
    if (p == NULL)
        return;   // unbound: dropped, see the note above
    switch (width)
    {
        case 2: *(uint16_t*)p = (uint16_t)value; break;
        case 4: *(uint32_t*)p = (uint32_t)value; break;
        case 8: *(uint64_t*)p = value;           break;
        default: break;
    }
}

/** S7 read: `len` bytes from byte offset `start` within the area. */
bool s7_read(void* ctx, uint8_t areaCode, uint16_t dbNumber,
             uint32_t start, uint16_t len, uint8_t* dest)
{
    (void)ctx;
    const s7comm_area_t* a = find_area(areaCode, dbNumber);
    if (a == NULL || start + len > a->size_bytes)
        return false;

    if (s7comm_is_bit_buffer(a->buffer))
    {
        // One S7 byte is eight consecutive located bits, LSB first, which is
        // what `%IX<byte>.<bit>` already means.
        for (uint16_t i = 0; i < len; i++)
        {
            uint8_t packed = 0;
            const uint16_t byteIndex = (uint16_t)(a->start_index + start + i);
            for (uint8_t b = 0; b < 8; b++)
            {
                const IEC_BOOL* p = bit_ptr(a->buffer, byteIndex, b);
                if (p != NULL && *p)
                    packed |= (uint8_t)(1u << b);
            }
            dest[i] = packed;
        }
        return true;
    }

    uint8_t width = 0;
    if (slot_ptr(a->buffer, 0, &width) == NULL && width == 0)
        return false;   // not a buffer this target has

    for (uint16_t i = 0; i < len; i++)
    {
        const uint32_t off       = start + i;
        const uint16_t slotIndex = (uint16_t)(a->start_index + off / width);
        const uint8_t  byteInSlot = (uint8_t)(off % width);

        uint8_t w = 0;
        const uint64_t value = slot_read(slot_ptr(a->buffer, slotIndex, &w), width);

        // Big-endian extraction: byte 0 of a slot is its MOST significant.
        dest[i] = (uint8_t)((value >> (8u * (width - 1u - byteInSlot))) & 0xFFu);
    }
    return true;
}

/** S7 write: `len` bytes at byte offset `start` within the area. */
bool s7_write(void* ctx, uint8_t areaCode, uint16_t dbNumber,
              uint32_t start, uint16_t len, const uint8_t* src)
{
    (void)ctx;
    const s7comm_area_t* a = find_area(areaCode, dbNumber);
    if (a == NULL || start + len > a->size_bytes)
        return false;
    if (!a->writable)
        return false;

    if (s7comm_is_bit_buffer(a->buffer))
    {
        // A byte-wide write to a bit area sets all eight.
        for (uint16_t i = 0; i < len; i++)
        {
            const uint16_t byteIndex = (uint16_t)(a->start_index + start + i);
            for (uint8_t b = 0; b < 8; b++)
            {
                IEC_BOOL* p = bit_ptr(a->buffer, byteIndex, b);
                if (p != NULL)
                    *p = (IEC_BOOL)((src[i] >> b) & 1u);
            }
        }
        return true;
    }

    uint8_t width = 0;
    if (slot_ptr(a->buffer, 0, &width) == NULL && width == 0)
        return false;

    for (uint16_t i = 0; i < len; i++)
    {
        const uint32_t off        = start + i;
        const uint16_t slotIndex  = (uint16_t)(a->start_index + off / width);
        const uint8_t  byteInSlot = (uint8_t)(off % width);

        uint8_t w = 0;
        void* p = slot_ptr(a->buffer, slotIndex, &w);
        if (p == NULL)
            continue;   // unbound: dropped

        // Read-modify-write, because a client may write one byte of a word; the
        // other byte of a WORD is the same variable, not a different output.
        const uint8_t shift = (uint8_t)(8u * (width - 1u - byteInSlot));
        uint64_t value = slot_read(p, width);
        value &= ~((uint64_t)0xFFu << shift);
        value |= (uint64_t)src[i] << shift;
        slot_write(p, width, value);
    }
    return true;
}

// ---------------------------------------------------------------------------
// Identification and CPU control
// ---------------------------------------------------------------------------

#if S7COMM_SZL_ENABLED

/** What this CPU says it is when a client asks.
 *
 *  Strings come from the project's S7 identity screen and live in flash. Many
 *  clients query the System Status List before doing anything else and refuse
 *  devices that will not answer, so this is a capability rather than always-on.
 *  The order code is an S7-315's, which clients recognise. */
const S7SrvIdentity g_identity = {
    S7COMM_ID_NAME,
    S7COMM_ID_MODULE_TYPE,
    "",                      // plant designation: not on the editor's screen
    S7COMM_ID_COPYRIGHT,
    S7COMM_ID_SERIAL,
    S7COMM_ID_MODULE_NAME,
    "6ES7 315-2EH14-0AB0",
};

/** A client asked to start or stop the PLC. Routed through the same request the
 *  Modbus debugger's run/stop uses, so the two cannot disagree; refused when the
 *  physical mode switch reads STOP. */
bool on_control(void* ctx, bool run)
{
    (void)ctx;
    const uint8_t result = runtime_request_plc_state(run ? PLC_STATE_RUNNING
                                                         : PLC_STATE_STOPPED);
    OPCUA_LOG("[s7] control %s -> %u", run ? "START" : "STOP", (unsigned)result);
    return result == PLC_CTRL_OK;
}

/** Keep the published status in step with the runtime's own. Polled, because the
 *  PLC can stop for reasons no S7 client asked for. */
void refresh_cpu_status(void)
{
    g_server.setCpuStatus(runtime_get_plc_state() == PLC_STATE_RUNNING
                              ? S7SRV_CPU_RUN
                              : S7SRV_CPU_STOP);
}

#endif // S7COMM_SZL_ENABLED

/** S7 single-bit write, so a bit write never re-asserts its seven neighbours --
 *  on the output area those are seven other physical outputs. */
bool s7_write_bit(void* ctx, uint8_t areaCode, uint16_t dbNumber,
                  uint32_t byteIndex, uint8_t bitIndex, bool value)
{
    (void)ctx;
    const s7comm_area_t* a = find_area(areaCode, dbNumber);
    if (a == NULL || byteIndex >= a->size_bytes)
        return false;
    if (!a->writable)
        return false;

    if (s7comm_is_bit_buffer(a->buffer))
    {
        IEC_BOOL* p = bit_ptr(a->buffer, (uint16_t)(a->start_index + byteIndex), bitIndex);
        if (p != NULL)
            *p = (IEC_BOOL)(value ? 1 : 0);
        return true;
    }

    // A bit inside a word area: read-modify-write of that word, since every bit
    // of it belongs to the same variable.
    uint8_t width = 0;
    if (slot_ptr(a->buffer, 0, &width) == NULL && width == 0)
        return false;

    const uint16_t slotIndex  = (uint16_t)(a->start_index + byteIndex / width);
    const uint8_t  byteInSlot = (uint8_t)(byteIndex % width);
    uint8_t w = 0;
    void* p = slot_ptr(a->buffer, slotIndex, &w);
    if (p == NULL)
        return true;   // unbound: dropped

    const uint8_t shift = (uint8_t)(8u * (width - 1u - byteInSlot) + bitIndex);
    uint64_t v = slot_read(p, width);
    if (value) v |=  ((uint64_t)1u << shift);
    else       v &= ~((uint64_t)1u << shift);
    slot_write(p, width, v);
    return true;
}

// ---------------------------------------------------------------------------
// Connection servicing
// ---------------------------------------------------------------------------

void drop(Conn& c)
{
    if (c.client != nullptr)
    {
        bm_net::release(c.client);
        c.client = nullptr;
    }
    c.have = 0;
}

/** Pull whatever has arrived on one connection and answer at most one frame, so
 *  a pipelining client cannot burst inside a single scan cycle. */
void service(Conn& c)
{
    if (c.client == nullptr)
        return;

    if (!c.client->connected() && c.client->available() == 0)
    {
        drop(c);
        return;
    }

    // Take only what is already buffered; never wait for the rest, so a peer
    // that sends half a frame cannot stall the scan.
    while (c.client->available() > 0 && c.have < sizeof(c.rx))
    {
        c.rx[c.have++] = (uint8_t)c.client->read();

        const uint16_t need = S7IsoFrameLength(c.rx, c.have);

        if (need == 0xFFFF)
        {
            // Not ISO-TCP, and a TPKT stream has no framing marker to
            // resynchronise to.
            OPCUA_LOG("[s7] drop: not ISO-TCP");
            drop(c);
            return;
        }

        if (need != 0 && c.have >= need)
        {
            uint16_t txLen = 0;
            const int r = g_server.handle(c.session, c.rx, need,
                                          c.tx, sizeof(c.tx), &txLen);
            c.have = 0;

            if (txLen != 0)
            {
                // Ask before writing: Energia's Client::write() spins on
                // delay(1) until lwIP's send buffer drains, which is unbounded
                // blocking on a remote peer's ACK inside a scan cycle.
                if (bm_net::can_send(c.client, txLen))
                {
                    c.client->write(c.tx, txLen);
                }
                else
                {
                    OPCUA_LOG("[s7] drop: send window %u short", (unsigned)txLen);
                    drop(c);
                    return;
                }
            }

            if (r == S7SRV_CLOSE)
                drop(c);

            return;   // one frame per pass
        }
    }

    if (c.have >= sizeof(c.rx))
    {
        // A frame that claims to fit and then does not, meaning the negotiated
        // PDU is smaller than what the peer sent.
        OPCUA_LOG("[s7] drop: frame past our buffer");
        drop(c);
    }
}

void accept_new()
{
    Client* incoming = g_listener.accept();
    if (incoming == nullptr)
        return;

    for (uint8_t i = 0; i < S7COMM_MAX_CLIENTS; i++)
    {
        if (g_conns[i].client == nullptr)
        {
            g_conns[i].client = incoming;
            g_conns[i].have   = 0;
            g_server.beginSession(g_conns[i].session);
            g_accepts++;
            OPCUA_LOG("[s7] accepted -> conn %u", (unsigned)i);
            return;
        }
    }

    // Close it rather than leaving it accepted-but-unserved: a clean close makes
    // the client retry instead of waiting for its own timeout.
    g_refused++;
    OPCUA_LOG("[s7] refused (all %u connections busy)", (unsigned)S7COMM_MAX_CLIENTS);
    bm_net::release(incoming);
}

} // namespace

// ---------------------------------------------------------------------------
void s7comm_init(void)
{
    for (uint8_t i = 0; i < S7COMM_MAX_CLIENTS; i++)
    {
        g_conns[i].client = nullptr;
        g_conns[i].have   = 0;
    }

    // Every area is served by the accessors above rather than a flat buffer: the
    // values live in the PLC program's storage, reached through the located
    // variable pointer arrays, so there is no block of bytes to hand over.
    for (uint8_t i = 0; i < S7COMM_AREA_COUNT; i++)
    {
        g_lib_areas[i].code     = S7COMM_AREAS[i].area;
        g_lib_areas[i].dbNumber = S7COMM_AREAS[i].db_number;
        g_lib_areas[i].data     = nullptr;
        g_lib_areas[i].size     = S7COMM_AREAS[i].size_bytes;
        g_lib_areas[i].readOnly = (S7COMM_AREAS[i].writable == 0);
    }
    g_server.setAreas(g_lib_areas, S7COMM_AREA_COUNT);
    g_server.setAccessors(s7_read, s7_write, nullptr);
    g_server.setBitWriter(s7_write_bit);
    g_server.setMaxPduSize(S7COMM_PDU_SIZE);
    g_server.setWriteEnabled(S7COMM_WRITE_ENABLED != 0);

#if S7COMM_SZL_ENABLED
    g_server.setIdentity(&g_identity);
    g_server.setControlHandler(on_control);
    refresh_cpu_status();
#endif

    if (!g_listener.begin())
    {
        OPCUA_LOG("[s7] listen FAILED on port %u", (unsigned)S7COMM_PORT);
        return;
    }

    g_started     = true;
    g_next_due_ms = millis();
    OPCUA_LOG("[s7] listening on %u  pdu=%u clients=%u areas=%u write=%u",
              (unsigned)S7COMM_PORT, (unsigned)S7COMM_PDU_SIZE,
              (unsigned)S7COMM_MAX_CLIENTS, (unsigned)S7COMM_AREA_COUNT,
              (unsigned)S7COMM_WRITE_ENABLED);
}

// ---------------------------------------------------------------------------
void s7commtask(uint32_t slack_us)
{
    if (!g_started)
        return;

    // Periodic census, the only way to see a slow leak on a device with no
    // debugger attached.
    {
        static unsigned long s_next = 0;
        const unsigned long now = millis();
        if ((long)(now - s_next) >= 0)
        {
            s_next = now + 15000;
            OPCUA_LOG("[s7] frames=%lu rejected=%lu accepts=%lu refused=%lu",
                      (unsigned long)g_server.frames(),
                      (unsigned long)g_server.rejected(),
                      (unsigned long)g_accepts, (unsigned long)g_refused);
            OPCUA_LOG("[s7] budget=%luus overruns=%lu max=%luus avg=%luus calls=%lu skipped=%lu forced=%lu",
                      (unsigned long)S7COMM_SCAN_BUDGET_US, (unsigned long)g_overruns,
                      (unsigned long)g_max_us,
                      (unsigned long)(g_calls ? (g_total_us / g_calls) : 0),
                      (unsigned long)g_calls, (unsigned long)g_skipped,
                      (unsigned long)g_forced);
        }
    }

    // Guaranteed service plus opportunistic service, the same shape Modbus and
    // opcuatask() use. A pure slack gate starves the protocol forever on a tight
    // scan interval, so slack only decides whether to run EARLY; once
    // S7COMM_SYNC_INTERVAL_MS has elapsed the server runs regardless. Slack is
    // recomputed between the two protocols so the second sees what the first left.
    const unsigned long now_ms = millis();
    const bool due = (long)(now_ms - g_next_due_ms) >= 0;
    if (!due && slack_us < S7COMM_WORST_CASE_US)
    {
        g_skipped++;
        return;
    }
    g_next_due_ms = now_ms + S7COMM_SYNC_INTERVAL_MS;
    if (due)
        g_forced++;

    const unsigned long t0 = micros();

#if S7COMM_SZL_ENABLED
    // Two integer reads, cheap enough to do every pass. Done here rather than in
    // the SZL handler so the handler stays free of runtime dependencies.
    refresh_cpu_status();
#endif

    accept_new();

    // Round-robin from where the last pass stopped.
    for (uint8_t n = 0; n < S7COMM_MAX_CLIENTS; n++)
    {
        const uint8_t i = (uint8_t)((g_cursor + n) % S7COMM_MAX_CLIENTS);
        service(g_conns[i]);
    }
    g_cursor = (uint8_t)((g_cursor + 1) % S7COMM_MAX_CLIENTS);

    const uint32_t spent = (uint32_t)(micros() - t0);
    if (spent > g_max_us)
        g_max_us = spent;
    g_total_us += spent;
    g_calls++;
    if (spent > S7COMM_SCAN_BUDGET_US)
        g_overruns++;
}

#else // !S7COMM_ENABLED

// No S7 server in this project. The entry points still exist so the scan loop
// needs no #ifdef; the linker drops them along with everything above.
void s7comm_init(void) {}
void s7commtask(uint32_t) {}

#endif // S7COMM_ENABLED
