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
 *  in the header: every Arduino server's `accept()` returns a client BY
 *  VALUE, so a pointer handed upward has to point at storage that outlives
 *  the call. `in_use` rather than relying on `connected()` because a slot
 *  stays ours between the peer closing and the server noticing. */
struct Slot
{
    opcua_client_impl_t client;
    bool               in_use;
};

Slot g_slots[OPCUA_NET_MAX_CLIENTS];

} // namespace

bool begin(uint16_t port)
{
    (void)port; // the listener is bound at construction, see g_server
    if (g_started)
        return true;

    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
        g_slots[i].in_use = false;

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

    // accept(), not available().
    //
    // available() hands back ANY established connection, round-robin, whether
    // or not it is new -- so a server that keeps per-connection state cannot
    // tell an arrival from a peer it already holds. accept() hands each
    // connection over exactly once, which is the semantic this layer needs and
    // the one Arduino Ethernet >= 2.0 and the ESP32 core both settled on (the
    // latter having deprecated available() outright).
    //
    // Everything that used to be here -- an eight-deep sweep of the underlying
    // table, and a dedupe keyed on the remote port -- existed only to
    // reconstruct that semantic from the outside, and could not do it
    // correctly: the port it compared was read back THROUGH the handle, so a
    // recycled slot reported the new peer's port and a genuinely new
    // connection was misread as one already held. Fixed in the core.
    opcua_client_impl_t incoming = g_server.accept();
    if (!incoming)
        return nullptr;

    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
    {
        if (!g_slots[i].in_use)
        {
            g_slots[i].client = incoming;
            g_slots[i].in_use = true;
            OPCUA_LOG("[net] accepted port=%d -> slot %u",
                      incoming.port(), (unsigned)i);
            return &g_slots[i].client;
        }
    }

    // Table full. Drop it now rather than leaving it half-accepted: an OPC-UA
    // client refused at the TCP layer retries immediately, and a connection we
    // neither serve nor close would sit in the backlog.
    OPCUA_LOG("[net] accept REFUSED (table full)");
    incoming.stop();
    return nullptr;
}

void release(Client* client)
{
    if (client == nullptr)
        return;
    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
    {
        if (g_slots[i].in_use && static_cast<Client*>(&g_slots[i].client) == client)
        {
            // Unconditional. A handle whose slot was recycled under us is
            // detected inside EthernetClient, where stop() is a no-op rather
            // than a teardown of whoever owns the slot now.
            g_slots[i].client.stop();
            g_slots[i].in_use = false;
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
            g_slots[i].client.stop();
            g_slots[i].in_use = false;
        }
    }
    g_started = false;
}

} // namespace opcua_net

#endif // OPCUA_ENABLED
