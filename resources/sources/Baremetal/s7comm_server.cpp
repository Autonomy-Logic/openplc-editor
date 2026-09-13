/*
s7comm_server.cpp - the baremetal Siemens S7Comm server
Copyright (C) 2026 Autonomy Logic

Siemens S7 over ISO-TCP (RFC 1006), port 102. The protocol an HMI, a SCADA
system, TIA Portal or another PLC already speaks -- and, on a LOGO!, the one
the hardware shipped with, so an installation configured against a Siemens
LOGO! keeps working against an OpenPLC one.

WHAT IS HERE AND WHAT IS NOT
----------------------------
The protocol itself is the Settimino library's S7Server: a transport-free
engine that takes one ISO-TCP frame and returns the bytes to reply with. It
owns no socket, never blocks, never allocates. This file is the other half --
the sockets, the per-connection state, the scan-cycle discipline, and the
bridge from S7 areas to the PLC's variables.

That split is deliberate and is what makes the protocol testable on a PC (see
the library's test/ directory, which runs a real python-snap7 client against
the engine with no board in the room).

THERE IS NO AUTHENTICATION IN CLASSIC S7
----------------------------------------
None. No password, no encryption, no session. Anyone who can reach port 102
can read and write every area registered below. That is the protocol, not this
implementation -- a genuine S7-300 offers exactly the same guarantee, and so
does stock LOGO! firmware. The editor's read-only option exists because for a
device on a plant network it is often the right answer.
*/

#include "s7comm_server.h"

#if S7COMM_ENABLED

#include <Arduino.h>
#include <string.h>

#include <S7Server.h>

#include "baremetal_net.h"
#include "opcua_log.h"       // shared debug transport; see below
#include "s7comm_types.h"
#include "arduino_runtime_glue.h"

// ---------------------------------------------------------------------------
// Tunables the generated config may override.
// ---------------------------------------------------------------------------

/** How often the server MUST run, whatever the scan cycle is doing.
 *
 *  The guarantee half of the scheduling rule below. Shares the OPC-UA server's
 *  default because it answers the same question -- how stale may a client's
 *  view of this PLC be -- and a project that tightens one usually means both. */
#ifndef S7COMM_SYNC_INTERVAL_MS
#define S7COMM_SYNC_INTERVAL_MS 100u
#endif

/** Time one service pass may spend before it is counted as an overrun.
 *
 *  Not a preemption: the frame handler is not interruptible, so this is
 *  measured after the fact and reported. Prevention is the admission test. */
#ifndef S7COMM_SCAN_BUDGET_US
#define S7COMM_SCAN_BUDGET_US 3000u
#endif

/** Slack a pass is admitted on.
 *
 *  An S7 exchange is one frame in, one frame out, against a PDU of a few
 *  hundred bytes -- no session establishment, no handshake, no crypto. It is
 *  cheap enough that the measured figure, not a guess, belongs here; this
 *  starts conservative and Phase 0 replaces it with what the device does. */
#ifndef S7COMM_WORST_CASE_US
#define S7COMM_WORST_CASE_US 1500u
#endif

namespace {

// ---------------------------------------------------------------------------
// Storage. All of it static, all of it sized at compile time, because the
// point of a PLC is that its memory use does not depend on what a peer does.
// ---------------------------------------------------------------------------

bm_net::Listener g_listener(S7COMM_PORT);

S7Server g_server;
bool     g_started = false;

/** One connection.
 *
 *  The rx buffer accumulates a frame; the tx buffer holds the reply. They are
 *  per-connection because two clients may be mid-frame at once, and they are
 *  sized from the negotiated PDU ceiling, which is the editor's choice and
 *  therefore visible in the build rather than discovered at runtime. */
struct Conn
{
    Client*      client;
    S7SrvSession session;
    uint16_t     have;      // bytes of a frame accumulated so far
    uint8_t      rx[S7ISO_HEADER_SIZE + S7COMM_PDU_SIZE];
    uint8_t      tx[S7ISO_HEADER_SIZE + S7COMM_PDU_SIZE];
};

Conn g_conns[S7COMM_MAX_CLIENTS];

/** Round-robin cursor, so a chatty client cannot starve a quiet one.
 *
 *  A member rather than a local for the reason the OPC-UA transport learned:
 *  restarting the sweep at zero every pass means connection 0 is always served
 *  first and connection N-1 only when everything before it is idle. */
uint8_t g_cursor = 0;

// Scheduling state
unsigned long g_next_due_ms = 0;

// Counters. Free to keep and the only way to see a slow problem on a device
// with no debugger attached.
uint32_t g_overruns = 0;
uint32_t g_max_us   = 0;
uint32_t g_total_us = 0;
uint32_t g_calls    = 0;
uint32_t g_skipped  = 0;
uint32_t g_forced   = 0;
uint32_t g_accepts  = 0;
uint32_t g_refused  = 0;

// ---------------------------------------------------------------------------
// The address space.
//
// Flash-resident and fixed at build time -- see s7comm_types.h. The generated
// s7comm_config.h defines S7COMM_AREAS[]; everything here reads it.
// ---------------------------------------------------------------------------

/** Find the area a request names. Linear because the table is a handful of
 *  entries and a binary search over flash would cost more in code than it
 *  saves in cycles. */
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

/** Pull whatever has arrived on one connection and answer at most one frame.
 *
 *  "At most one" on purpose: a client that pipelines requests gets them served
 *  across successive passes rather than in one unbounded burst inside a scan
 *  cycle. Returns the microseconds spent, for the overrun accounting. */
void service(Conn& c)
{
    if (c.client == nullptr)
        return;

    if (!c.client->connected() && c.client->available() == 0)
    {
        drop(c);
        return;
    }

    // Take only what is already buffered. Never wait for the rest: a peer that
    // sends half a frame and stops must not be able to stall the scan.
    while (c.client->available() > 0 && c.have < sizeof(c.rx))
    {
        c.rx[c.have++] = (uint8_t)c.client->read();

        const uint16_t need = S7IsoFrameLength(c.rx, c.have);

        if (need == 0xFFFF)
        {
            // Not ISO-TCP at all. Nothing to resynchronise to -- a TPKT stream
            // has no framing marker to hunt for -- so the only correct move is
            // to stop believing this peer.
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
                // Ask before writing. Energia's Client::write() spins on
                // delay(1) until lwIP's send buffer drains, which inside a
                // scan cycle is unbounded blocking on a remote peer's ACK --
                // measured at 1.27 SECONDS in one iteration against a 20 ms
                // cycle during the OPC-UA work. A reply we cannot send now is
                // a dropped connection, which the client retries; a scan cycle
                // that stops is a machine that stops.
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
        // A frame that claims to fit and then does not. S7IsoFrameLength()
        // already rejected anything past the protocol ceiling, so reaching
        // here means the negotiated PDU is smaller than what the peer sent.
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

    // At the ceiling. Close it rather than leaving it accepted-but-unserved:
    // a client that gets a clean close retries, a client left hanging waits
    // for its own timeout and reports the device as unresponsive.
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

    g_server.setAreas(nullptr, 0);      // Phase 1 wires S7COMM_AREAS in
    g_server.setMaxPduSize(S7COMM_PDU_SIZE);
    g_server.setWriteEnabled(S7COMM_WRITE_ENABLED != 0);

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

    // Periodic census. Cheap, and the only way to see a slow leak: a one-shot
    // dump after a failure cannot tell "exhausted gradually" from "exhausted
    // at the moment of failure", and those have different fixes.
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

    // Guaranteed service, plus opportunistic service -- the same shape Modbus
    // has and the same one opcuatask() uses, for the same reason.
    //
    // A pure slack gate was WRONG and briefly shipped in the OPC-UA server. On
    // a scan interval short enough that the PLC logic and Modbus consume most
    // of it, the slack test never passes and the protocol is starved FOREVER:
    // it does not degrade, it stops, and the tighter the cycle the more
    // completely it fails -- exactly backwards from a graceful limit.
    //
    // So slack only decides whether to run EARLY. Once S7COMM_SYNC_INTERVAL_MS
    // has elapsed the server runs regardless, and an overrun is REPORTED
    // rather than hidden. A scan cycle that cannot afford one S7 frame per
    // sync interval is a project whose scan interval is mis-set, and a visible
    // overrun count says so where a silently dead protocol does not.
    //
    // Note what makes this safe to have TWO of: slack is recomputed between
    // opcuatask() and s7commtask() in the scan loop, so the second protocol
    // sees what the first actually left. Two protocols each politely taking
    // "their" slack from the same stale number would together overrun the
    // cycle.
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

// No S7 server in this project. The two entry points still exist so the scan
// loop needs no #ifdef, and they compile to a return -- which the linker then
// drops along with everything above.
void s7comm_init(void) {}
void s7commtask(uint32_t) {}

#endif // S7COMM_ENABLED
