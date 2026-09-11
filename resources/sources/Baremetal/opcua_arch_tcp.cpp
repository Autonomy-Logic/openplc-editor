/*
opcua_arch_tcp.cpp - open62541 TCP ConnectionManager over the Arduino Client seam
Copyright (C) 2026 Autonomy Logic

The transport open62541 talks to. It is built ONLY on opcua_net.h, which means
this file contains no board macros and no socket calls: the network family is
decided once, in opcua_net.h, and everything here sees an abstract `Client*`.
That is the whole point of the seam — see opcua_net.h for what the alternative
cost modbus_tcp.cpp.

Connection identity is the slot index + 1, so connectionId 0 is never valid and
a zeroed field cannot masquerade as a live connection.
*/

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <Arduino.h>
#include <string.h>

// Umbrella, not the nested paths: arduino-cli resolves a library by
// basename at src/ root, so <open62541/...> discovers nothing and the
// precompiled archive silently misses the link. See the header itself.
#include <open62541.h>

#include "opcua_arch.h"
#include "opcua_log.h"
#include "opcua_net.h"

namespace {

/** One buffer pair per session, sized by the protocol floor.
 *
 *  OPC-UA Part 6 6.7.1 requires a conformant endpoint to accept and emit an
 *  8192-byte chunk, so this is a floor and not a tuning choice — open62541
 *  rejects a negotiated buffer below it (ua_securechannel.c). It is also the
 *  reason maxSessions is the expensive capability: 16 KB per session, and
 *  nothing else in the design comes close. */
constexpr size_t kRecvBufSize = 8192;

struct Conn
{
    Client*  client;      // owned by opcua_net; nullptr when the slot is free
    void*    context;     // open62541's per-connection context
    UA_ConnectionManager_connectionCallback cb;
    void*    application;
    bool     announced;   // ESTABLISHED already delivered
};

/** The listener is itself a "connection" as far as open62541 is concerned.
 *
 *  serverNetworkCallback registers the listening socket as a
 *  UA_ServerConnection the first time it is announced with a NULL context, and
 *  reads `listen-port` / `listen-address` from the params to build the
 *  DiscoveryUrls a client needs. Accepted clients then INHERIT that context,
 *  which is how the server tells a fresh client apart from its own listener.
 *  Skipping this is why the first device test came back with port 4840 closed:
 *  the listener opened, and the server never knew it existed. */
constexpr uintptr_t kListenerId = OPCUA_NET_MAX_CLIENTS + 1;

struct ArduinoTcpCM
{
    UA_ConnectionManager base;   // MUST be first: open62541 casts between them
    Conn                 conns[OPCUA_NET_MAX_CLIENTS];
    uint8_t              recv[kRecvBufSize];
    bool                 listening;
    void*                listener_context;   // what accepted clients inherit
    UA_ConnectionManager_connectionCallback cb;
    void*                application;
    UA_UInt16            port;
};

ArduinoTcpCM* self(UA_ConnectionManager* cm) { return reinterpret_cast<ArduinoTcpCM*>(cm); }

Conn* conn_for(ArduinoTcpCM* m, uintptr_t id)
{
    if (id == 0 || id > OPCUA_NET_MAX_CLIENTS)
        return nullptr;
    Conn* c = &m->conns[id - 1];
    return (c->client != nullptr) ? c : nullptr;
}

void drop(ArduinoTcpCM* m, uint8_t idx)
{
    Conn& c = m->conns[idx];
    if (c.client == nullptr)
        return;
    // Tell open62541 first, while the id is still resolvable, so it can release
    // its SecureChannel before the slot is reused.
    if (c.cb != nullptr)
    {
        c.cb(&m->base, (uintptr_t)(idx + 1), c.application, &c.context,
             UA_CONNECTIONSTATE_CLOSING, &UA_KEYVALUEMAP_NULL, UA_BYTESTRING_NULL);
    }
    OPCUA_LOG("[cm] drop id=%u", (unsigned)(idx + 1));
    opcua_net::release(c.client);
    c.client    = nullptr;
    c.context   = nullptr;
    c.cb        = nullptr;
    c.announced = false;
}

// ---------------------------------------------------------------------------
// UA_ConnectionManager entry points
// ---------------------------------------------------------------------------

/** open62541 calls this both to LISTEN and to dial out.
 *
 *  This server only listens: a `port` parameter with no `hostname` is a listen
 *  request, and anything else is an outbound connect we deliberately do not
 *  support (the OPC-UA client role, reverse-connect and PubSub are all out of
 *  scope for this build). Refusing explicitly beats half-implementing it. */
UA_StatusCode cm_open(UA_ConnectionManager* cm, const UA_KeyValueMap* params,
                      void* application, void* context,
                      UA_ConnectionManager_connectionCallback connectionCallback)
{
    ArduinoTcpCM* m = self(cm);

    // `listen` is the real indicator, not the absence of an address: the
    // server sets `address` as an ARRAY of String when the endpoint URL has a
    // hostname, so treating its presence as "this is an outbound connect"
    // rejected perfectly good listen requests.
    const UA_Boolean* listen = (const UA_Boolean*)UA_KeyValueMap_getScalar(
        params, UA_QUALIFIEDNAME(0, (char*)"listen"), &UA_TYPES[UA_TYPES_BOOLEAN]);
    const UA_UInt16* port = (const UA_UInt16*)UA_KeyValueMap_getScalar(
        params, UA_QUALIFIEDNAME(0, (char*)"port"), &UA_TYPES[UA_TYPES_UINT16]);

    if (listen == nullptr || !*listen || port == nullptr)
    {
        // Outbound connects are the client role / reverse-connect / PubSub,
        // none of which this build has. Refusing explicitly beats
        // half-implementing it.
        return UA_STATUSCODE_BADNOTIMPLEMENTED;
    }

    if (!m->listening)
    {
        if (!opcua_net::begin(*port))
            return UA_STATUSCODE_BADCONNECTIONREJECTED;
        m->listening = true;
    }

    m->cb          = connectionCallback;
    m->application = application;
    m->port        = *port;
    m->listener_context = context;   // NULL on the first call, by design

    // Announce the listener. The server needs `listen-port` and
    // `listen-address` to publish a DiscoveryUrl; without them a client that
    // connects is told there is no matching endpoint.
    UA_String addr = UA_STRING_STATIC(OPCUA_BIND_ADDRESS);
    UA_KeyValuePair kv[2];
    kv[0].key = UA_QUALIFIEDNAME(0, (char*)"listen-port");
    UA_Variant_setScalar(&kv[0].value, &m->port, &UA_TYPES[UA_TYPES_UINT16]);
    kv[1].key = UA_QUALIFIEDNAME(0, (char*)"listen-address");
    UA_Variant_setScalar(&kv[1].value, &addr, &UA_TYPES[UA_TYPES_STRING]);
    UA_KeyValueMap kvm = {2, kv};

    if (m->cb != nullptr)
    {
        m->cb(cm, kListenerId, m->application, &m->listener_context,
              UA_CONNECTIONSTATE_ESTABLISHED, &kvm, UA_BYTESTRING_NULL);
    }
    OPCUA_LOG("[cm] listening port=%u announced", (unsigned)m->port);
    return UA_STATUSCODE_GOOD;
}

UA_StatusCode cm_send(UA_ConnectionManager* cm, uintptr_t connectionId,
                      const UA_KeyValueMap* params, UA_ByteString* buf)
{
    (void)params;
    ArduinoTcpCM* m = self(cm);
    Conn* c = conn_for(m, connectionId);
    if (c == nullptr || buf == nullptr)
    {
        if (buf != nullptr)
            cm->freeNetworkBuffer(cm, connectionId, buf);
        return UA_STATUSCODE_BADCONNECTIONCLOSED;
    }

    size_t sent = 0;
    while (sent < buf->length)
    {
        if (!c->client->connected())
            break;
        const size_t n = c->client->write(buf->data + sent, buf->length - sent);
        if (n == 0)
            break;   // would block; the peer is not draining
        sent += n;
    }

    const size_t want = buf->length;
    // open62541 hands ownership of the buffer to send(), success or not.
    cm->freeNetworkBuffer(cm, connectionId, buf);
    if (sent != want)
        OPCUA_LOG("[cm] send SHORT id=%lu %u/%u", (unsigned long)connectionId,
                  (unsigned)sent, (unsigned)want);
    return (sent == want) ? UA_STATUSCODE_GOOD : UA_STATUSCODE_BADCONNECTIONCLOSED;
}

UA_StatusCode cm_close(UA_ConnectionManager* cm, uintptr_t connectionId)
{
    ArduinoTcpCM* m = self(cm);
    if (connectionId == kListenerId)
    {
        // Closing the listener: report CLOSING so the server deregisters its
        // UA_ServerConnection, then drop the socket.
        if (m->cb != nullptr)
        {
            m->cb(cm, kListenerId, m->application, &m->listener_context,
                  UA_CONNECTIONSTATE_CLOSING, &UA_KEYVALUEMAP_NULL, UA_BYTESTRING_NULL);
        }
        if (m->listening) { opcua_net::end(); m->listening = false; }
        return UA_STATUSCODE_GOOD;
    }
    if (connectionId == 0 || connectionId > OPCUA_NET_MAX_CLIENTS)
        return UA_STATUSCODE_BADNOTFOUND;
    drop(m, (uint8_t)(connectionId - 1));
    return UA_STATUSCODE_GOOD;
}

/** Network buffers come from the arena, like every other OPC-UA allocation,
 *  so send buffers cannot escape the declared footprint. */
UA_StatusCode cm_alloc(UA_ConnectionManager* cm, uintptr_t connectionId,
                       UA_ByteString* buf, size_t bufSize)
{
    (void)cm; (void)connectionId;
    return UA_ByteString_allocBuffer(buf, bufSize);
}

void cm_freebuf(UA_ConnectionManager* cm, uintptr_t connectionId, UA_ByteString* buf)
{
    (void)cm; (void)connectionId;
    UA_ByteString_clear(buf);
}

UA_StatusCode es_start(UA_EventSource* es)
{
    es->state = UA_EVENTSOURCESTATE_STARTED;
    return UA_STATUSCODE_GOOD;
}

void es_stop(UA_EventSource* es)
{
    ArduinoTcpCM* m = reinterpret_cast<ArduinoTcpCM*>(es);
    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
        drop(m, i);
    if (m->listening)
    {
        opcua_net::end();
        m->listening = false;
    }
    es->state = UA_EVENTSOURCESTATE_STOPPED;
}

UA_StatusCode es_free(UA_EventSource* es)
{
    if (es->state != UA_EVENTSOURCESTATE_STOPPED)
        return UA_STATUSCODE_BADINTERNALERROR;
    UA_String_clear(&es->name);
    UA_free(es);
    return UA_STATUSCODE_GOOD;
}

} // namespace

void opcua_cm_poll(UA_ConnectionManager* cm)
{
    ArduinoTcpCM* m = self(cm);
    if (!m->listening)
        return;

    // 1. Accept. opcua_net owns the client storage and recycles slots whose
    //    peer has gone, so this cannot exhaust the table.
    Client* incoming = opcua_net::accept();
    if (incoming != nullptr)
    {
        bool placed = false;
        for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS && !placed; i++)
        {
            if (m->conns[i].client != nullptr)
                continue;
            m->conns[i].client      = incoming;
            // Inherit the listener's context: that is how the server
            // recognises a new client on its own server socket and attaches a
            // SecureChannel on the first callback.
            m->conns[i].context     = m->listener_context;
            m->conns[i].cb          = m->cb;
            m->conns[i].application = m->application;
            m->conns[i].announced   = false;
            placed = true;
        }
        if (!placed)
        {
            OPCUA_LOG("[cm] accept REFUSED (table full)");
            opcua_net::release(incoming);
        }
        else
            OPCUA_LOG("[cm] accepted");
    }

    // 2. Announce and drain.
    for (uint8_t i = 0; i < OPCUA_NET_MAX_CLIENTS; i++)
    {
        Conn& c = m->conns[i];
        if (c.client == nullptr)
            continue;
        const uintptr_t id = (uintptr_t)(i + 1);

        if (!c.announced)
        {
            c.announced = true;
            if (c.cb != nullptr)
            {
                c.cb(cm, id, c.application, &c.context,
                     UA_CONNECTIONSTATE_ESTABLISHED, &UA_KEYVALUEMAP_NULL, UA_BYTESTRING_NULL);
            }
        }

        // The only place a connection is retired. Checking available() too
        // means a peer that closed after sending a final request still gets
        // that request processed before the channel goes away.
        if (!c.client->connected() && c.client->available() == 0)
        {
            drop(m, i);
            continue;
        }

        // One read per poll, capped at the buffer. Bounding the work per scan
        // matters more than draining a fast peer in one go: opcuatask() is
        // time-boxed, and an unbounded loop here would be the thing that
        // blows the budget.
        const int avail = c.client->available();
        if (avail <= 0)
            continue;
        size_t want = (size_t)avail;
        if (want > kRecvBufSize)
            want = kRecvBufSize;
        const int got = c.client->read(m->recv, want);
        if (got <= 0)
            continue;
        OPCUA_LOG("[cm] rx id=%lu %d bytes (avail=%d)", (unsigned long)id, got, avail);

        UA_ByteString msg;
        msg.data   = m->recv;
        msg.length = (size_t)got;
        if (c.cb != nullptr)
        {
            c.cb(cm, id, c.application, &c.context,
                 UA_CONNECTIONSTATE_ESTABLISHED, &UA_KEYVALUEMAP_NULL, msg);
        }
    }
}

UA_ConnectionManager* UA_ConnectionManager_new_Arduino_TCP(const UA_String eventSourceName)
{
    ArduinoTcpCM* m = static_cast<ArduinoTcpCM*>(UA_calloc(1, sizeof(ArduinoTcpCM)));
    if (m == nullptr)
        return nullptr;

    UA_ConnectionManager* cm = &m->base;
    cm->eventSource.eventSourceType = UA_EVENTSOURCETYPE_CONNECTIONMANAGER;
    UA_String_copy(&eventSourceName, &cm->eventSource.name);
    cm->eventSource.start = es_start;
    cm->eventSource.stop  = es_stop;
    cm->eventSource.free  = es_free;
    cm->eventSource.state = UA_EVENTSOURCESTATE_STOPPED;
    cm->protocol           = UA_STRING_STATIC("tcp");
    cm->openConnection     = cm_open;
    cm->sendWithConnection = cm_send;
    cm->closeConnection    = cm_close;
    cm->allocNetworkBuffer = cm_alloc;
    cm->freeNetworkBuffer  = cm_freebuf;
    return cm;
}

#endif // OPCUA_ENABLED
