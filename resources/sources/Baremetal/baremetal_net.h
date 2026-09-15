/*
baremetal_net.h - the one place the runtime names a concrete network class
Copyright (C) 2026 Autonomy Logic

Everything above this header is typed on Arduino's abstract `Client`, so the
protocol servers contain no board macros. An unrecognised target is a hard
#error rather than a fallback, because a generic fall-through has produced both
compile failures and silent runtime faults.

Each protocol declares its own `Listener` with its own port but they share one
slot pool. This seam does not bring the interface up: the network is already
configured by the Modbus TCP layer from the project's network screen.
*/

#ifndef BAREMETAL_NET_H
#define BAREMETAL_NET_H

#include "opcua_config.h"
#include "s7comm_config.h"

/** True when at least one protocol server needs a listening socket; with both
 *  disabled this entire file is empty. */
#define BM_NET_ENABLED (OPCUA_ENABLED || S7COMM_ENABLED)

#if BM_NET_ENABLED

#include <Arduino.h>
#include <Client.h>
#include <stdint.h>

// The generated `defines.h` carries the board identity (BOARD_LOGO8, ...) and
// the interface kind (MBTCP_ETHERNET / MBTCP_WIFI) the adapter selection keys
// on. It has no include guard, so the project routes it through exactly one
// path -- `modbus_config.h` -- and every gated TU picks it up from there. This
// is a dependency on the build configuration, not on Modbus.
#include "modbus_config.h"

// ---------------------------------------------------------------------------
// Adapter selection: the only board-conditional block in the network layer.
// Most specific target first, interface-kind defines last, hard stop when
// nothing matches.
// ---------------------------------------------------------------------------
#if defined(BOARD_LOGO8)
    // Energia lwIP <Ethernet.h>, deliberately without <SPI.h>: there is no SPI
    // Ethernet shield on this variant and the core's <SPI.h> hard-errors.
    #include <Ethernet.h>
    typedef EthernetServer bm_server_impl_t;
    typedef EthernetClient bm_client_impl_t;

#elif defined(BOARD_ESP32)
    // Covers both interfaces on purpose: on the ESP32 the RMII Ethernet MAC and
    // the Wi-Fi station share one lwIP netif, so `WiFiServer` is the listening
    // socket for either. There is no `EthernetServer` in this core.
    #include <WiFi.h>
    typedef WiFiServer bm_server_impl_t;
    typedef WiFiClient bm_client_impl_t;

#elif defined(BOARD_ESP8266)
    #include <ESP8266WiFi.h>
    typedef WiFiServer bm_server_impl_t;
    typedef WiFiClient bm_client_impl_t;

#elif defined(BOARD_PICOW)
    #include <WiFi.h>
    typedef WiFiServer bm_server_impl_t;
    typedef WiFiClient bm_client_impl_t;

#elif defined(BOARD_PORTENTA)
    #include <Ethernet.h>
    typedef EthernetServer bm_server_impl_t;
    typedef EthernetClient bm_client_impl_t;

#elif defined(MBTCP_ETHERNET)
    // Generic WIZnet-style SPI Ethernet shield. Reached only by targets that
    // genuinely use one, because every chip with its own MAC is named above.
    #include <SPI.h>
    #include <Ethernet.h>
    typedef EthernetServer bm_server_impl_t;
    typedef EthernetClient bm_client_impl_t;

#elif defined(MBTCP_WIFI)
    #include <SPI.h>
    #include <WiFi.h>
    typedef WiFiServer bm_server_impl_t;
    typedef WiFiClient bm_client_impl_t;

#else
    #error "baremetal_net: no network adapter for this target. Add a branch keyed on the target's capability define -- do not add a fallback."
#endif

// Slot budget. A slot is an Arduino `Client` handle, not a protocol buffer, so
// this is sized for TCP churn rather than sessions. OPC-UA asks for
// maxSessions + 5 so a live connection overlapping a not-yet-reaped one cannot
// fill the table; S7 asks for maxClients + 1 so a connection arriving at the
// ceiling can be refused politely rather than dropped at the TCP layer.
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

namespace bm_net {

/** One listening socket.
 *
 *  A class rather than a `listen(port)` free function because every Arduino
 *  server object is constructed with its port and is not reliably copyable or
 *  assignable across cores. Accepted clients go into the shared pool, so
 *  `release()` and `can_send()` are free functions. */
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

    /** Next newly-connected client on this listener, or nullptr.
     *
     *  The returned pointer is to shared-pool storage, so it stays valid until
     *  `release()`. Deliberately not a `Client` by value: the concrete
     *  `accept()` on every Arduino server returns a temporary. */
    Client* accept();

    /** Close this listener. Does not touch clients -- they are the pool's. */
    void end();

private:
    bm_server_impl_t impl_;
    bool             started_;
    uint8_t          reserve_;
    uint8_t          id_;      // which slots in the shared pool are ours
};

/** Hand a client slot back. Closes the connection if still open. */
void release(Client* client);

/** Can `need` bytes be queued on `client` right now without blocking?
 *
 *  Arduino's abstract `Client` has no such query -- `availableForWrite()` is
 *  declared on the concrete classes, not the base -- so the seam asks on the
 *  caller's behalf. It matters because `write()` blocks: Energia's spins on
 *  `delay(1)` until lwIP's send buffer drains, which inside a scan cycle is
 *  unbounded. */
bool can_send(const Client* client, size_t need);

/** Service the stack. A no-op on cores whose driver is interrupt-driven; the
 *  hook exists for stacks that need cooperative polling. */
void poll();

/** Close every client in the pool. Listeners close themselves. */
void close_all();

} // namespace bm_net

#endif // BM_NET_ENABLED
#endif // BAREMETAL_NET_H
