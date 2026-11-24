// SPDX-License-Identifier: GPL-3.0-only
/*
baremetal_net.h - the one place the runtime names a concrete network class
Copyright (c) 2026 Autonomy®

Everything above this header is typed on Arduino's abstract `Client`, so the
protocol servers contain no board macros. An unrecognised target is a hard
#error rather than a fallback, because a generic fall-through has produced both
compile failures and silent runtime faults.

Each protocol declares its own `Listener` with its own port but they share one
slot pool. The Modbus master's outbound `Connection`s are slots of their own,
one per endpoint, outside that pool. This seam does not bring the interface up: setup() does that from the
project's network screen, gated on OPLC_NET_ENABLED, before any protocol here
starts listening. It used to be the Modbus TCP layer's job, which made a network
without a Modbus server impossible.
*/

#ifndef BAREMETAL_NET_H
#define BAREMETAL_NET_H

#include "opcua_config.h"
#include "s7comm_config.h"
#include "modbus_master_config.h"

/** True when a protocol server needs a listening socket or the Modbus master
 *  polls a TCP device; otherwise this entire file is empty. */
#define BM_NET_ENABLED (OPCUA_ENABLED || S7COMM_ENABLED || MB_MASTER_TCP_ENABLED)

#if BM_NET_ENABLED

#include <Arduino.h>
#include <Client.h>
#include <stdint.h>

#include "modbus_config.h"

/** How an outbound Connection reaches the stack: through the library client
 *  with its connect timeout, a raw non-blocking lwIP socket, or a non-blocking
 *  mbed TCPSocket. Each adapter branch below picks one. */
#define BM_NET_CONNECT_CLIENT 0
#define BM_NET_CONNECT_LWIP   1
#define BM_NET_CONNECT_MBED   2

#if defined(BOARD_LOGO8)
    #include <Ethernet.h>
    typedef EthernetServer bm_server_impl_t;
    typedef EthernetClient bm_client_impl_t;

#elif defined(BOARD_ESP32)
    #include <WiFi.h>
    typedef WiFiServer bm_server_impl_t;
    typedef WiFiClient bm_client_impl_t;
    #define BM_NET_CONNECT BM_NET_CONNECT_LWIP

#elif defined(BOARD_ESP8266)
    #include <ESP8266WiFi.h>
    typedef WiFiServer bm_server_impl_t;
    typedef WiFiClient bm_client_impl_t;

#elif defined(BOARD_WIFININA) && defined(MBTCP_WIFI)
    #include <WiFiNINA.h>
    #include <utility/server_drv.h>
    #include <utility/wifi_drv.h>
    #include <utility/WiFiSocketBuffer.h>
    #define BM_NET_NINA 1

namespace bm_net {

/** A u-blox NINA module socket (Nano 33 IoT, Mkr WiFi, Nano RP2040 Connect)
 *  as an Arduino `Client`, driven through the WiFiNINA module driver
 *  (`ServerDrv`, `WiFiSocketBuffer`). write() is one module exchange that
 *  returns what the module took: no retry, no data-sent poll, no delay.
 *  stop() releases the socket without waiting for the close. connect(host)
 *  resolves no names and fails. */
class NinaClient : public Client
{
public:
    NinaClient();
    explicit NinaClient(uint8_t sock);

    /** Bound of the module's connect, in ms; 0 leaves the module's default. */
    void setConnectionTimeout(uint16_t timeout_ms);

    int connect(IPAddress ip, uint16_t port) override;
    int connect(const char* host, uint16_t port) override;
    size_t write(uint8_t b) override;
    size_t write(const uint8_t* buf, size_t size) override;
    int available() override;
    int read() override;
    int read(uint8_t* buf, size_t size) override;
    int peek() override;
    void flush() override;
    void stop() override;
    uint8_t connected() override;
    operator bool() override;

    /** The peer's TCP port, read from the module in one exchange; 0 when the
     *  client holds no socket. Used by the OPC-UA debug log only. */
    uint16_t port();

    using Print::write;

private:
    uint8_t  sock_;
    uint16_t timeout_ms_;
};

/** A NINA module listening socket that hands each accepted socket over as a
 *  NinaClient, through the module driver. */
class NinaServer
{
public:
    explicit NinaServer(uint16_t port);

    /** Open the listening socket on the module. */
    void begin();

    /** The next accepted socket, or a client that tests false. */
    NinaClient accept();

    /** The last socket handed out while it is connected and has data, else a
     *  socket with data the module reports without accepting it, else a
     *  client that tests false. Used by the OPC-UA debug log only. */
    NinaClient available();

private:
    uint16_t port_;
    uint8_t  sock_;
    uint8_t  last_sock_;
};

}

    typedef bm_net::NinaServer bm_server_impl_t;
    typedef bm_net::NinaClient bm_client_impl_t;

#elif defined(BOARD_PICOW) && defined(MBTCP_WIFI)
    #include <WiFi.h>
    typedef WiFiServer bm_server_impl_t;
    typedef WiFiClient bm_client_impl_t;

#elif defined(BOARD_PORTENTA) && defined(MBTCP_WIFI)
    #include <WiFi.h>
    typedef WiFiServer bm_server_impl_t;
    typedef WiFiClient bm_client_impl_t;
    #if defined(ARDUINO_ARCH_ESP32)
        #define BM_NET_CONNECT BM_NET_CONNECT_LWIP
    #elif defined(ARDUINO_ARCH_MBED)
        #define BM_NET_CONNECT BM_NET_CONNECT_MBED
        #define BM_NET_MBED_NETWORK() (WiFi.getNetwork())
    #else
        #define BM_NET_CLOSE_WAITS 1
    #endif

#elif defined(MBETH_MBED_LWIP)
    #include <Ethernet.h>
    typedef EthernetServer bm_server_impl_t;
    typedef EthernetClient bm_client_impl_t;
    #if defined(ARDUINO_ARCH_MBED)
        #define BM_NET_CONNECT BM_NET_CONNECT_MBED
        #define BM_NET_MBED_NETWORK() (Ethernet.getNetwork())
    #endif

#elif defined(MBETH_SPI)
    #include <SPI.h>
    #if defined(MBTCP_ETH_ENC28J60)
        #include <EthernetENC.h>
    #else
        #include <Ethernet.h>
    #endif
    typedef EthernetServer bm_server_impl_t;
    typedef EthernetClient bm_client_impl_t;

#elif defined(MBTCP_WIFI)
    #include <SPI.h>
    #include <WiFi.h>
    typedef WiFiServer bm_server_impl_t;
    typedef WiFiClient bm_client_impl_t;
    #define BM_NET_CLOSE_WAITS 1

#else
    #error "baremetal_net: no network adapter for this target. Add a branch keyed on the target's capability define -- do not add a fallback."
#endif

#ifndef BM_NET_CONNECT
    #define BM_NET_CONNECT BM_NET_CONNECT_CLIENT
#endif

#ifndef BM_NET_CLOSE_WAITS
    #define BM_NET_CLOSE_WAITS 0
#endif

#if OPCUA_ENABLED
#  define BM_NET_OPCUA_SLOTS (OPCUA_MAX_SESSIONS + 5)
#else
#  define BM_NET_OPCUA_SLOTS 0
#endif

#if S7COMM_ENABLED
#  define BM_NET_S7_SLOTS (S7COMM_MAX_CLIENTS + 1)
#else
#  define BM_NET_S7_SLOTS 0
#endif

#define BM_NET_MAX_CLIENTS (BM_NET_OPCUA_SLOTS + BM_NET_S7_SLOTS)

#if MB_MASTER_TCP_ENABLED
#  define BM_NET_MASTER_SLOTS MB_MASTER_ENDPOINT_COUNT
#else
#  define BM_NET_MASTER_SLOTS 0
#endif

#if BM_NET_MASTER_SLOTS > 0 && BM_NET_CONNECT == BM_NET_CONNECT_MBED
    #include "netsocket/TCPSocket.h"
    #include "netsocket/SocketAddress.h"
#endif

namespace bm_net {

/** One listening socket. */
class Listener
{
public:
    /** `reserve` is how many slots this listener may always have, even when
     *  another protocol is churning through connections. Below its reserve a
     *  listener is always served; above it, it takes from what is free. Set it
     *  to the protocol's own client ceiling. */
    Listener(uint16_t port, uint8_t reserve);

    /** Open the socket. Does not configure the interface -- see the header
     *  comment. Idempotent; returns false only if the port could not be opened. */
    bool begin();

    /** Next newly-connected client on this listener, or nullptr. */
    Client* accept();

    /** Close this listener. Does not touch clients -- they are the pool's. */
    void end();

private:
    bm_server_impl_t impl_;
    bool             started_;
    uint8_t          reserve_;
    uint8_t          id_;
};

/** Hand a client slot back. Closes the connection if still open. */
void release(Client* client);

/** Can `need` bytes be queued on `client` right now without blocking? */
bool can_send(const Client* client, size_t need);

/** Service the stack. A no-op on cores whose driver is interrupt-driven; the
 *  hook exists for stacks that need cooperative polling. */
void poll();

/** Close every client in the pool. Listeners close themselves. */
void close_all();

#if BM_NET_MASTER_SLOTS > 0

/** Whether the board's network interface is up and addressed, as the stack reports it now. */
bool link_up();

/** State of an outbound Connection. */
enum ConnStatus : uint8_t
{
    BM_CONN_CLOSED,
    BM_CONN_PENDING,
    BM_CONN_CONNECTED,
    BM_CONN_FAILED
};

/** Outcome of Connection::send(). */
enum SendResult : uint8_t
{
    BM_SEND_OK,
    BM_SEND_NO_ROOM,
    BM_SEND_LOST
};

/** One outbound TCP connection, the Modbus master's slot for one endpoint.
 *
 *  Never blocks past the connect timeout: on the ESP32 and mbed cores the
 *  connect is native and non-blocking and poll() advances it; elsewhere the
 *  library's connect runs inside start() with its timeout set to
 *  `timeout_ms`. A failed, timed-out or closed connection gives its socket
 *  back at once, without the library's graceful wait where it has a form that
 *  skips it (BM_NET_CLOSE_WAITS otherwise). No name resolution: the peer is an
 *  IPv4 address. */
class Connection
{
public:
    Connection();

    /** Begin connecting to `ip`:`port`. False when it failed at once (no free
     *  socket, refused); poll() then reports BM_CONN_FAILED. */
    bool start(const uint8_t ip[4], uint16_t port, uint32_t timeout_ms);

    /** Advance a pending connect and report the state. */
    ConnStatus poll();

    /** Move up to `cap` received bytes into `buf` without waiting: the count,
     *  0 when nothing is there, -1 once the stack reports the connection lost. */
    int read(uint8_t* buf, size_t cap);

    /** Queue the whole of `buf` without blocking: BM_SEND_NO_ROOM when the stack
     *  has no room for all of it (nothing is sent; on NINA, when the module took
     *  none of it), BM_SEND_LOST on a send error or a partial send. */
    SendResult send(const uint8_t* buf, size_t len);

    /** Close the connection and give its socket back. Idempotent: on a closed
     *  connection it makes no library call. */
    void close();

private:
    void fail();
#if BM_NET_CONNECT != BM_NET_CONNECT_CLIENT
    void advance();
#endif

    ConnStatus status_;
    uint32_t   started_ms_;
    uint32_t   timeout_ms_;
#if BM_NET_CONNECT == BM_NET_CONNECT_LWIP
    int        fd_;
#elif BM_NET_CONNECT == BM_NET_CONNECT_MBED
    TCPSocket     socket_;
    SocketAddress peer_;
    bool          open_;
#else
    bm_client_impl_t client_;
#endif
};

#endif

}

#endif
#endif
