/*
opcua_net.cpp - concrete network adapter for the OPC-UA server
Copyright (C) 2026 Autonomy Logic

The only translation unit in the OPC-UA layer that touches a network class.
See opcua_net.h for why the seam exists and why an unrecognised target is a
hard #error rather than a fallback.
*/

#include "opcua_net.h"

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

    // Reap slots the peer has dropped before asking for a new connection, so
    // a client that reconnects in a loop cannot exhaust the table.
    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
    {
        if (g_slots[i].in_use && !g_slots[i].client.connected())
        {
            g_slots[i].client.stop();
            g_slots[i].in_use = false;
        }
    }

    opcua_client_impl_t incoming = g_server.available();
    if (!incoming)
        return nullptr;

    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
    {
        if (!g_slots[i].in_use)
        {
            g_slots[i].client = incoming;
            g_slots[i].in_use = true;
            return &g_slots[i].client;
        }
    }

    // Table full. Drop it now rather than leaving it half-accepted: an
    // OPC-UA client refused at the TCP layer retries immediately, and a
    // connection we neither serve nor close would sit in the backlog.
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
