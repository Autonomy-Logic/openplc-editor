// SPDX-License-Identifier: GPL-3.0-only
/*
baremetal_net.cpp - the concrete network adapter every protocol server shares
Copyright (c) 2026 Autonomy®

The only translation unit in the runtime's protocol layers that touches a
network class. See baremetal_net.h for why the seam exists and why an
unrecognised target is a hard #error rather than a fallback.
*/

#include "baremetal_net.h"

#if BM_NET_ENABLED

#include "opcua_log.h"

namespace bm_net {

#if defined(BM_NET_NINA)

NinaClient::NinaClient()
    : sock_(NO_SOCKET_AVAIL), timeout_ms_(0)
{
}

NinaClient::NinaClient(uint8_t sock)
    : sock_(sock), timeout_ms_(0)
{
}

void NinaClient::setConnectionTimeout(uint16_t timeout_ms)
{
    timeout_ms_ = timeout_ms;
}

int NinaClient::connect(IPAddress ip, uint16_t port)
{
    stop();
    sock_ = ServerDrv::getSocket();
    if (sock_ == NO_SOCKET_AVAIL)
        return 0;
    ServerDrv::startClient(nullptr, 0, uint32_t(ip), port, sock_, TCP_MODE, timeout_ms_);
    if (ServerDrv::getClientState(sock_) == ESTABLISHED)
        return 1;
    stop();
    return 0;
}

int NinaClient::connect(const char* host, uint16_t port)
{
    (void)host;
    (void)port;
    return 0;
}

size_t NinaClient::write(uint8_t b)
{
    return write(&b, 1);
}

size_t NinaClient::write(const uint8_t* buf, size_t size)
{
    if (sock_ == NO_SOCKET_AVAIL || size == 0 || size > 0xFFFFu)
    {
        setWriteError();
        return 0;
    }
    const uint16_t sent = ServerDrv::sendData(sock_, buf, (uint16_t)size);
    if (sent == 0)
        setWriteError();
    return sent;
}

int NinaClient::available()
{
    return sock_ == NO_SOCKET_AVAIL ? 0 : WiFiSocketBuffer.available(sock_);
}

int NinaClient::read()
{
    uint8_t b = 0;
    return read(&b, 1) == 1 ? b : -1;
}

int NinaClient::read(uint8_t* buf, size_t size)
{
    return sock_ == NO_SOCKET_AVAIL ? 0 : WiFiSocketBuffer.read(sock_, buf, size);
}

int NinaClient::peek()
{
    return sock_ == NO_SOCKET_AVAIL ? -1 : WiFiSocketBuffer.peek(sock_);
}

void NinaClient::flush()
{
}

void NinaClient::stop()
{
    if (sock_ == NO_SOCKET_AVAIL)
        return;
    ServerDrv::stopClient(sock_);
    WiFiSocketBuffer.close(sock_);
    sock_ = NO_SOCKET_AVAIL;
}

uint8_t NinaClient::connected()
{
    if (sock_ == NO_SOCKET_AVAIL)
        return 0;
    if (available() > 0)
        return 1;
    return ServerDrv::getClientState(sock_) == ESTABLISHED ? 1 : 0;
}

NinaClient::operator bool()
{
    return sock_ != NO_SOCKET_AVAIL;
}

uint16_t NinaClient::port()
{
    if (sock_ == NO_SOCKET_AVAIL)
        return 0;
    uint8_t remote_ip[4] = {0};
    uint8_t remote_port[2] = {0};
    WiFiDrv::getRemoteData(sock_, remote_ip, remote_port);
    return (uint16_t)((remote_port[0] << 8) + remote_port[1]);
}

NinaServer::NinaServer(uint16_t port)
    : port_(port), sock_(NO_SOCKET_AVAIL), last_sock_(NO_SOCKET_AVAIL)
{
}

void NinaServer::begin()
{
    if (sock_ != NO_SOCKET_AVAIL)
        return;
    sock_ = ServerDrv::getSocket();
    if (sock_ != NO_SOCKET_AVAIL)
        ServerDrv::startServer(port_, sock_);
}

NinaClient NinaServer::accept()
{
    if (sock_ == NO_SOCKET_AVAIL)
        return NinaClient();
    return NinaClient(ServerDrv::availServer(sock_, true));
}

NinaClient NinaServer::available()
{
    if (sock_ == NO_SOCKET_AVAIL)
        return NinaClient();
    if (last_sock_ != NO_SOCKET_AVAIL)
    {
        NinaClient last(last_sock_);
        if (last.connected() && last.available() > 0)
            return last;
    }
    const uint8_t sock = ServerDrv::availServer(sock_);
    if (sock == NO_SOCKET_AVAIL)
        return NinaClient();
    last_sock_ = sock;
    return NinaClient(sock);
}

#endif

#if BM_NET_MASTER_SLOTS > 0 && BM_NET_CONNECT == BM_NET_CONNECT_CLIENT && !defined(BM_NET_NINA)
namespace {

/** Whether `need` bytes can be queued on `client` without blocking. */
bool room_for(bm_client_impl_t& client, size_t need)
{
    const int room = client.availableForWrite();
    return room > 0 && (size_t)room >= need;
}

}
#endif

#if BM_NET_MAX_CLIENTS > 0

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
#if defined(BM_NET_NINA)
            return need <= 0xFFFFu;
#else
            const int room = g_slots[i].client.availableForWrite();
            return room > 0 && (size_t)room >= need;
#endif
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

#endif

void poll()
{
    // Every adapter selected in baremetal_net.h drives its stack from an
    // interrupt, so there is nothing cooperative to service here today. The hook
    // is kept so callers never have to learn which stack they are on.
}

#if BM_NET_MAX_CLIENTS > 0
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
#endif

#if BM_NET_MASTER_SLOTS > 0
void Connection::fail()
{
    close();
    status_ = BM_CONN_FAILED;
}

ConnStatus Connection::poll()
{
#if BM_NET_CONNECT != BM_NET_CONNECT_CLIENT
    if (status_ == BM_CONN_PENDING)
        advance();
#endif
    return status_;
}
#endif

} // namespace bm_net

#if BM_NET_MASTER_SLOTS > 0 && BM_NET_CONNECT == BM_NET_CONNECT_LWIP

#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <lwip/sockets.h>

namespace bm_net {

namespace {

/** Whether `fd` would take more bytes now, asked without waiting. */
bool writable(int fd)
{
    fd_set set;
    FD_ZERO(&set);
    FD_SET(fd, &set);
    struct timeval none;
    none.tv_sec = 0;
    none.tv_usec = 0;
    return lwip_select(fd + 1, NULL, &set, NULL, &none) > 0 && FD_ISSET(fd, &set);
}

/** Whether the last socket call failed only because it would have had to wait. */
bool would_block()
{
    return errno == EWOULDBLOCK || errno == EAGAIN;
}

}

Connection::Connection()
    : status_(BM_CONN_CLOSED), started_ms_(0), timeout_ms_(0), fd_(-1)
{
}

bool Connection::start(const uint8_t ip[4], uint16_t port, uint32_t timeout_ms)
{
    close();
    started_ms_ = millis();
    timeout_ms_ = timeout_ms;

    fd_ = lwip_socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
    if (fd_ < 0)
    {
        fail();
        return false;
    }
    const int flags = fcntl(fd_, F_GETFL, 0);
    if (flags < 0 || fcntl(fd_, F_SETFL, flags | O_NONBLOCK) < 0)
    {
        fail();
        return false;
    }

    struct sockaddr_in peer;
    memset(&peer, 0, sizeof(peer));
    peer.sin_family = AF_INET;
    peer.sin_port = htons(port);
    memcpy(&peer.sin_addr.s_addr, ip, 4);

    if (lwip_connect(fd_, (struct sockaddr*)&peer, sizeof(peer)) == 0)
    {
        status_ = BM_CONN_CONNECTED;
        return true;
    }
    if (errno != EINPROGRESS)
    {
        fail();
        return false;
    }
    status_ = BM_CONN_PENDING;
    return true;
}

void Connection::advance()
{
    if (writable(fd_))
    {
        int error = 0;
        socklen_t size = sizeof(error);
        if (lwip_getsockopt(fd_, SOL_SOCKET, SO_ERROR, &error, &size) < 0 || error != 0)
            fail();
        else
            status_ = BM_CONN_CONNECTED;
        return;
    }
    if ((uint32_t)(millis() - started_ms_) >= timeout_ms_)
        fail();
}

int Connection::read(uint8_t* buf, size_t cap)
{
    if (status_ != BM_CONN_CONNECTED)
        return -1;
    if (cap == 0)
        return 0;
    const int got = lwip_recv(fd_, buf, cap, MSG_DONTWAIT);
    if (got > 0)
        return got;
    if (got < 0 && would_block())
        return 0;
    fail();
    return -1;
}

SendResult Connection::send(const uint8_t* buf, size_t len)
{
    if (status_ != BM_CONN_CONNECTED)
        return BM_SEND_LOST;
    if (!writable(fd_))
        return BM_SEND_NO_ROOM;
    const int sent = lwip_send(fd_, buf, len, MSG_DONTWAIT);
    if (sent >= 0 && (size_t)sent == len)
        return BM_SEND_OK;
    if (sent < 0 && would_block())
        return BM_SEND_NO_ROOM;
    fail();
    return BM_SEND_LOST;
}

void Connection::close()
{
    if (fd_ >= 0)
    {
        lwip_close(fd_);
        fd_ = -1;
    }
    status_ = BM_CONN_CLOSED;
}

}

#elif BM_NET_MASTER_SLOTS > 0 && BM_NET_CONNECT == BM_NET_CONNECT_MBED

namespace bm_net {

Connection::Connection()
    : status_(BM_CONN_CLOSED), started_ms_(0), timeout_ms_(0), open_(false)
{
}

bool Connection::start(const uint8_t ip[4], uint16_t port, uint32_t timeout_ms)
{
    close();
    started_ms_ = millis();
    timeout_ms_ = timeout_ms;

    NetworkInterface* const network = BM_NET_MBED_NETWORK();
    if (network == nullptr || socket_.open(network) != NSAPI_ERROR_OK)
    {
        fail();
        return false;
    }
    open_ = true;
    socket_.set_blocking(false);
    peer_.set_ip_bytes(ip, NSAPI_IPv4);
    peer_.set_port(port);
    status_ = BM_CONN_PENDING;
    advance();
    return status_ != BM_CONN_FAILED;
}

void Connection::advance()
{
    const nsapi_error_t result = socket_.connect(peer_);
    if (result == NSAPI_ERROR_OK || result == NSAPI_ERROR_IS_CONNECTED)
    {
        status_ = BM_CONN_CONNECTED;
        return;
    }
    if (result != NSAPI_ERROR_IN_PROGRESS && result != NSAPI_ERROR_ALREADY &&
        result != NSAPI_ERROR_WOULD_BLOCK)
    {
        fail();
        return;
    }
    if ((uint32_t)(millis() - started_ms_) >= timeout_ms_)
        fail();
}

int Connection::read(uint8_t* buf, size_t cap)
{
    if (status_ != BM_CONN_CONNECTED)
        return -1;
    if (cap == 0)
        return 0;
    const nsapi_size_or_error_t got = socket_.recv(buf, cap);
    if (got > 0)
        return (int)got;
    if (got == NSAPI_ERROR_WOULD_BLOCK)
        return 0;
    fail();
    return -1;
}

SendResult Connection::send(const uint8_t* buf, size_t len)
{
    if (status_ != BM_CONN_CONNECTED)
        return BM_SEND_LOST;
    const nsapi_size_or_error_t sent = socket_.send(buf, len);
    if (sent >= 0 && (size_t)sent == len)
        return BM_SEND_OK;
    if (sent == NSAPI_ERROR_WOULD_BLOCK)
        return BM_SEND_NO_ROOM;
    fail();
    return BM_SEND_LOST;
}

void Connection::close()
{
    if (open_)
    {
        socket_.close();
        open_ = false;
    }
    status_ = BM_CONN_CLOSED;
}

}

#elif BM_NET_MASTER_SLOTS > 0

namespace bm_net {

namespace {

/** Overload ranks for timed_connect(): the highest one that compiles wins. */
struct rank0 {};
struct rank1 : rank0 {};
struct rank2 : rank1 {};

/** Connect through a library overload that takes the timeout itself. */
template <typename C>
auto timed_connect(C& client, const IPAddress& ip, uint16_t port, uint32_t ms, rank2)
    -> decltype(client.connect(ip, port, (unsigned long)ms))
{
    return client.connect(ip, port, (unsigned long)ms);
}

/** Connect after setting the library's connection timeout, capped at its 16-bit range. */
template <typename C>
auto timed_connect(C& client, const IPAddress& ip, uint16_t port, uint32_t ms, rank1)
    -> decltype(client.setConnectionTimeout((uint16_t)ms), client.connect(ip, port))
{
    client.setConnectionTimeout((uint16_t)(ms > 0xFFFFu ? 0xFFFFu : ms));
    return client.connect(ip, port);
}

/** Connect after setting the stream timeout, which the library's connect waits on. */
template <typename C>
int timed_connect(C& client, const IPAddress& ip, uint16_t port, uint32_t ms, rank0)
{
    client.setTimeout(ms);
    return client.connect(ip, port);
}

/** Close through the library's bounded stop(), waiting at most 1 ms for the peer's acknowledgements
 *  (ESP8266, Pico W; their stop() and abort() otherwise wait up to 300 ms). */
template <typename C>
auto quick_stop(C& client, rank2) -> decltype(client.stop(1u), void())
{
    client.stop(1u);
}

/** Close after setting the connection timeout to 0, so stop() checks the socket once and closes it
 *  (Ethernet 2.0.2: one status check, at most delay(1)). */
template <typename C>
auto quick_stop(C& client, rank1) -> decltype(client.setConnectionTimeout(0), void())
{
    client.setConnectionTimeout(0);
    client.stop();
}

/** Close through stop(), for a library whose stop() takes no bound. */
template <typename C>
void quick_stop(C& client, rank0)
{
    client.stop();
}

}

Connection::Connection()
    : status_(BM_CONN_CLOSED), started_ms_(0), timeout_ms_(0)
{
}

bool Connection::start(const uint8_t ip[4], uint16_t port, uint32_t timeout_ms)
{
    close();
    started_ms_ = millis();
    timeout_ms_ = timeout_ms;
    const IPAddress peer(ip[0], ip[1], ip[2], ip[3]);
    status_ = BM_CONN_PENDING;
    if (timed_connect(client_, peer, port, timeout_ms, rank2()) > 0 && client_.connected())
    {
        status_ = BM_CONN_CONNECTED;
        return true;
    }
    fail();
    return false;
}

int Connection::read(uint8_t* buf, size_t cap)
{
    if (status_ != BM_CONN_CONNECTED)
        return -1;
    const int available = client_.available();
    if (available > 0)
    {
        const size_t take = (size_t)available < cap ? (size_t)available : cap;
        if (take == 0)
            return 0;
        const int got = client_.read(buf, take);
        return got > 0 ? got : 0;
    }
    if (!client_.connected())
    {
        fail();
        return -1;
    }
    return 0;
}

SendResult Connection::send(const uint8_t* buf, size_t len)
{
    if (status_ != BM_CONN_CONNECTED)
        return BM_SEND_LOST;
#if defined(BM_NET_NINA)
    const size_t sent = client_.write(buf, len);
    if (sent == 0)
        return BM_SEND_NO_ROOM;
#else
    if (!room_for(client_, len))
        return BM_SEND_NO_ROOM;
    const size_t sent = client_.write(buf, len);
#endif
    if (sent != len)
    {
        fail();
        return BM_SEND_LOST;
    }
    return BM_SEND_OK;
}

void Connection::close()
{
    if (status_ == BM_CONN_PENDING || status_ == BM_CONN_CONNECTED)
        quick_stop(client_, rank2());
    status_ = BM_CONN_CLOSED;
}

}

#endif

#endif // BM_NET_ENABLED
