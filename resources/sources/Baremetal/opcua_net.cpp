/*
opcua_net.cpp - concrete network adapter for the OPC-UA server
Copyright (C) 2026 Autonomy Logic

The only translation unit in the OPC-UA layer that touches a network class.
See opcua_net.h for why the seam exists and why an unrecognised target is a
hard #error rather than a fallback.
*/

#include "opcua_net.h"
#include "opcua_log.h"

#if OPCUA_ENABLED

namespace opcua_net {

namespace {

/** The listener. Constructed with the configured port rather than a literal
 *  so a project that moves off 4840 needs no code change. */
opcua_server_impl_t g_server(OPCUA_PORT);
bool g_started = false;

/** Client storage.
 *
 *  Concrete objects, not `Client*`, and owned here for the reason spelled out
 *  in the header: every Arduino server's `available()` returns a client BY
 *  VALUE, so a pointer handed upward has to point at storage that outlives
 *  the call. `in_use` rather than relying on `connected()` because a slot
 *  stays ours between the peer closing and the server noticing. */
struct Slot
{
    opcua_client_impl_t client;
    bool               in_use;
    /** The remote port this slot was accepted with — the connection's
     *  IDENTITY, not a diagnostic. `client` is a non-owning handle onto the
     *  underlying server's slot table, so it silently re-points when the
     *  stack recycles that slot for the next peer. Comparing the live port
     *  against this one is what tells the two apart; see alive(). */
    uint16_t           port;
};

Slot g_slots[OPCUA_NET_MAX_CLIENTS];

} // namespace

bool begin(uint16_t port)
{
    (void)port; // the listener is bound at construction, see g_server
    if (g_started)
        return true;

    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
    {
        g_slots[i].in_use = false;
        g_slots[i].port   = 0;
    }

    // NOTE: no Ethernet.begin() / WiFi.begin() here. The interface is already
    // up — Modbus TCP configured it from the project's network screen before
    // the PLC started scanning. Re-initialising it would reset the link out
    // from under a live Modbus session and, on a static-IP build, put two
    // claims on one address.
    g_server.begin();
    g_started = true;
    return true;
}

Client* accept()
{
    if (!g_started)
        return nullptr;

    // NO reaping here, deliberately.
    //
    // This used to free slots whose peer had gone, which looked like good
    // hygiene and was in fact a lifetime bug: the ConnectionManager above
    // still held a pointer to the slot, so it never noticed the close, never
    // delivered UA_CONNECTIONSTATE_CLOSING, and open62541 kept the
    // SecureChannel alive. With maxSecureChannels = 1 the next client was then
    // refused — observed on hardware as one good session followed by
    // BadInternalError on reconnect, recovering only when the stale channel
    // eventually timed out.
    //
    // Connection lifetime belongs to exactly one layer. The CM detects the
    // close, tells open62541, and calls release() — which is what actually
    // frees the slot below.

    // Ask repeatedly, not once.
    //
    // Arduino's Server::available() hands back ONE client per call, chosen
    // round-robin from every ESTABLISHED connection — not only new ones, and
    // not only ones with pending data. So a single call very often returns a
    // peer we are already tracking. Returning nullptr at that point (the
    // first version of this function) meant a genuinely NEW connection sitting
    // in the next slot was never accepted: observed as strictly alternating
    // session failures, with the CM log showing three accepts for six
    // connections.
    //
    // The sweep has to cover the UNDERLYING server's table, not ours.
    //
    // Energia's EthernetServer::available() picks round-robin from its own
    // MAX_CLIENTS slots using a `static` cursor declared inside the member
    // function — so it is shared by EVERY EthernetServer instance in the
    // image. Modbus (502) and the debug log (23) each call available() once
    // per scan too, so the cursor is being advanced by other servers between
    // our calls and cannot be reasoned about locally.
    //
    // Sweeping only our own table size left new connections unseen for many
    // scans: measured as three accepts for six sequential clients, with the
    // unlucky ones failing while the lucky ones worked. Sweeping the full
    // underlying table guarantees one scan sees every ESTABLISHED slot no
    // matter where the shared cursor happens to be.
    constexpr uint8_t kUnderlyingSlots = 8;   // EthernetServer::MAX_CLIENTS
    for (uint8_t attempt = 0; attempt < kUnderlyingSlots; attempt++)
    {
        opcua_client_impl_t incoming = g_server.available();
        if (!incoming)
        {
            if (attempt == 0)
            {
                // Only interesting when we hold nothing: "no client at all"
                // while a peer is mid-handshake is the case to explain.
                uint8_t held = 0;
                for (uint8_t k = 0; k < OPCUA_NET_MAX_CLIENTS; k++)
                    if (g_slots[k].in_use) held++;
                if (held == 0)
                    OPCUA_LOG("[net] available()=none (held=0)");
            }
            return nullptr;
        }

        const uint16_t incoming_port = (uint16_t)incoming.port();
        // Compare against the RECORDED port, never the live one. A slot whose
        // peer has gone and been replaced reads back the NEW port, so a live
        // comparison would call a genuinely new connection "already ours" and
        // let the stale slot swallow its bytes — which is the bug alive()
        // exists to close. The stale slot is reaped by the caller before this
        // runs, so at most one slot ever carries a given recorded port.
        bool already_ours = false;
        for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
        {
            if (g_slots[i].in_use && g_slots[i].port == incoming_port)
            {
                already_ours = true;        // the owning slot reads its data
                break;
            }
        }
        if (already_ours)
            continue;                       // ask again for a different one

        OPCUA_LOG("[net] new client port=%d (attempt %u)", incoming_port, (unsigned)attempt);

        for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
        {
            if (!g_slots[i].in_use)
            {
                g_slots[i].client = incoming;
                g_slots[i].port   = incoming_port;
                g_slots[i].in_use = true;
                return &g_slots[i].client;
            }
        }

        // Table full and this one is new. Drop it now rather than leaving it
        // half-accepted: an OPC-UA client refused at the TCP layer retries
        // immediately, and a connection we neither serve nor close would sit
        // in the backlog.
        incoming.stop();
        return nullptr;
    }
    return nullptr;   // every ESTABLISHED client is already ours
}

bool alive(const Client* client)
{
    if (client == nullptr)
        return false;
    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
    {
        if (g_slots[i].in_use &&
            static_cast<const Client*>(&g_slots[i].client) == client)
        {
            // port() reads through the handle to the underlying stack slot.
            // 0 means the stack closed it; anything else means a different
            // peer now owns the slot. Either way this connection is over.
            return (uint16_t)g_slots[i].client.port() == g_slots[i].port;
        }
    }
    return false;
}

void release(Client* client)
{
    if (client == nullptr)
        return;
    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
    {
        if (g_slots[i].in_use && static_cast<Client*>(&g_slots[i].client) == client)
        {
            // Only close what we still own. If the underlying slot has already
            // been recycled for a new peer, stop() would tear down THAT
            // connection — killing an innocent client that has done nothing
            // but arrive at the wrong moment. Dropping the handle is enough;
            // the stack reclaimed our side when the peer went away.
            if ((uint16_t)g_slots[i].client.port() == g_slots[i].port)
                g_slots[i].client.stop();
            else
                OPCUA_LOG("[net] slot %u recycled under us, not stopping", (unsigned)i);
            g_slots[i].in_use = false;
            g_slots[i].port   = 0;
            return;
        }
    }
}

void poll()
{
    // Every adapter selected in opcua_net.h drives its stack from an
    // interrupt (the Tiva EMAC handler on the LOGO!, the Wi-Fi task on the
    // ESP32, the shield's SPI polling inside EthernetClient), so there is
    // nothing cooperative to service here today. The hook is kept because
    // the alternative is callers learning which stack they are on, which is
    // exactly the knowledge this seam exists to contain.
}

void end()
{
    if (!g_started)
        return;
    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
    {
        if (g_slots[i].in_use)
        {
            if ((uint16_t)g_slots[i].client.port() == g_slots[i].port)
                g_slots[i].client.stop();
            g_slots[i].in_use = false;
            g_slots[i].port   = 0;
        }
    }
    g_started = false;
}

} // namespace opcua_net

#endif // OPCUA_ENABLED
