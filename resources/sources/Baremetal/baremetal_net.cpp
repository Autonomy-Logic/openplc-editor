/*
baremetal_net.cpp - the concrete network adapter every protocol server shares
Copyright (C) 2026 Autonomy Logic

The only translation unit in the runtime's protocol layers that touches a
network class. See baremetal_net.h for why the seam exists and why an
unrecognised target is a hard #error rather than a fallback.
*/

#include "baremetal_net.h"

#if BM_NET_ENABLED

#include "opcua_log.h"

namespace bm_net {

namespace {

/** Client storage, shared by every listener.
 *
 *  Concrete objects, not `Client*`, and owned here because every Arduino
 *  server's `accept()` returns a client by value, so a pointer handed upward has
 *  to point at storage that outlives the call. `in_use` rather than
 *  `connected()` because a slot stays ours between the peer closing and the
 *  server noticing. */
struct Slot
{
    bm_client_impl_t client;
    bool             in_use;
    uint8_t          owner;   // which Listener took it
};

Slot g_slots[BM_NET_MAX_CLIENTS];
bool g_pool_ready = false;

/** Listener ids are handed out in construction order. Kept here rather than on
 *  the Listener because the admission test has to ask about the other
 *  listeners. */
#define BM_NET_MAX_LISTENERS 4
uint8_t g_next_listener_id = 0;
uint8_t g_reserves[BM_NET_MAX_LISTENERS] = { 0, 0, 0, 0 };

/** How many slots one listener currently holds. */
uint8_t held_by(uint8_t owner)
{
    uint8_t n = 0;
    for (uint8_t i = 0; i < BM_NET_MAX_CLIENTS; i++)
        if (g_slots[i].in_use && g_slots[i].owner == owner)
            n++;
    return n;
}

/** How many slots are free. */
uint8_t free_slots()
{
    uint8_t n = 0;
    for (uint8_t i = 0; i < BM_NET_MAX_CLIENTS; i++)
        if (!g_slots[i].in_use)
            n++;
    return n;
}

/** Slots that must stay available so every other listener can still reach its
 *  floor. */
uint8_t owed_to_others(uint8_t me)
{
    uint8_t owed = 0;
    for (uint8_t l = 0; l < g_next_listener_id && l < BM_NET_MAX_LISTENERS; l++)
    {
        if (l == me)
            continue;
        const uint8_t held = held_by(l);
        if (held < g_reserves[l])
            owed = (uint8_t)(owed + (g_reserves[l] - held));
    }
    return owed;
}

void ensure_pool()
{
    if (g_pool_ready)
        return;
    for (uint8_t i = 0; i < BM_NET_MAX_CLIENTS; i++)
        g_slots[i].in_use = false;
    g_pool_ready = true;
}

} // namespace

Listener::Listener(uint16_t port, uint8_t reserve)
    : impl_(port), started_(false), reserve_(reserve), id_(g_next_listener_id)
{
    if (g_next_listener_id < BM_NET_MAX_LISTENERS)
        g_reserves[g_next_listener_id] = reserve;
    g_next_listener_id++;
}

bool Listener::begin()
{
    if (started_)
        return true;

    ensure_pool();

    // No Ethernet.begin() / WiFi.begin() here: the interface is already up,
    // configured by Modbus TCP from the project's network screen before the PLC
    // started scanning. Re-initialising it would reset the link out from under a
    // live Modbus session and, on a static-IP build, put two claims on one address.
    impl_.begin();
    started_ = true;
    return true;
}

Client* Listener::accept()
{
    if (!started_)
        return nullptr;

    // accept(), not available(). available() hands back any established
    // connection, round-robin, whether or not it is new, so a server keeping
    // per-connection state cannot tell an arrival from a peer it already holds.
    // accept() hands each connection over exactly once, which is what Arduino
    // Ethernet >= 2.0 and the ESP32 core both settled on.
    bm_client_impl_t incoming = impl_.accept();
    if (!incoming)
        return nullptr;

    // Below our own floor we are always served. Above it we may take a slot only
    // if that still leaves every other listener able to reach its floor;
    // otherwise a protocol in a reconnect burst empties the pool under a quieter one.
    const uint8_t mine = held_by(id_);
    if (mine >= reserve_ && free_slots() <= owed_to_others(id_))
    {
        // Nothing left. Drop it now rather than leaving it half-accepted: a
        // client refused at the TCP layer retries immediately, and a connection
        // we neither serve nor close sits in the backlog.
        OPCUA_LOG("[net] accept REFUSED (listener %u holds %u/%u, %u free, %u owed)",
                  (unsigned)id_, (unsigned)mine, (unsigned)reserve_,
                  (unsigned)free_slots(), (unsigned)owed_to_others(id_));
        incoming.stop();
        return nullptr;
    }

    for (uint8_t i = 0; i < BM_NET_MAX_CLIENTS; i++)
    {
        if (!g_slots[i].in_use)
        {
            g_slots[i].client = incoming;
            g_slots[i].in_use = true;
            g_slots[i].owner  = id_;
            OPCUA_LOG("[net] accepted port=%d -> slot %u (listener %u)",
                      incoming.port(), (unsigned)i, (unsigned)id_);
            return &g_slots[i].client;
        }
    }

    OPCUA_LOG("[net] accept REFUSED (no free slot)");
    incoming.stop();
    return nullptr;
}

void Listener::end()
{
    started_ = false;
}

bool can_send(const Client* client, size_t need)
{
    if (client == nullptr)
        return false;
    for (uint8_t i = 0; i < BM_NET_MAX_CLIENTS; i++)
    {
        if (g_slots[i].in_use &&
            static_cast<const Client*>(&g_slots[i].client) == client)
        {
            // The concrete type is the whole reason this lives here.
            const int room = g_slots[i].client.availableForWrite();
            return room > 0 && (size_t)room >= need;
        }
    }
    return false;
}

void release(Client* client)
{
    if (client == nullptr)
        return;
    for (uint8_t i = 0; i < BM_NET_MAX_CLIENTS; i++)
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
    // Every adapter selected in baremetal_net.h drives its stack from an
    // interrupt, so there is nothing cooperative to service here today. The hook
    // is kept so callers never have to learn which stack they are on.
}

void close_all()
{
    if (!g_pool_ready)
        return;
    for (uint8_t i = 0; i < BM_NET_MAX_CLIENTS; i++)
    {
        if (g_slots[i].in_use)
        {
            g_slots[i].client.stop();
            g_slots[i].in_use = false;
        }
    }
}

} // namespace bm_net

#endif // BM_NET_ENABLED
