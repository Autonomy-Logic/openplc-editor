/*
baremetal_net.h - the ONE place the runtime names a concrete network class
Copyright (C) 2026 Autonomy Logic

Everything above this header is typed on Arduino's abstract `Client`, so the
protocol servers -- OPC-UA and its open62541 ConnectionManager, S7Comm and its
ISO-TCP engine -- contain no board macros at all.  Adding a network family is
this file and nothing else.

It was `opcua_net.h` until S7Comm arrived and the choice was between a second
seam and one shared one.  A second would have been a second list of board
branches to keep in step, and the six defects the first one flushed out of the
core's Ethernet library (connection identity, the 250 ms reply latency floor,
use-after-free on RST) were found ONCE and fixed ONCE.  Finding them twice is
not a plan.

WHY THIS SEAM EXISTS
--------------------
`modbus_tcp.cpp` is the cautionary case.  It names `EthernetServer` /
`WiFiServer` / `ETH` inline behind `BOARD_ESP32` / `BOARD_ESP8266` /
`BOARD_PORTENTA` / `BOARD_PICOW` / `BOARD_LOGO8`, and every family that does
NOT name itself falls through to a generic `#else` that assumes the classic
Arduino WIZnet-shield stack.  Three live defects come out of that fall-through:

  - `industrialshields:esp32` boards declare `ISPLC_ESP32_PLC_*` and never
    `BOARD_ESP32`, so they take the generic branch and fail to compile —
    its 1- and 2-argument `WiFi.config()` calls do not exist on that core.
  - the same boards' Ethernet path picks up whichever `Ethernet` library
    arduino-cli resolves first, which on a machine with a sketchbook copy is
    an `EthernetServer` that does not override the core's pure
    `Server::begin(uint16_t)` — an abstract-class error that depends on what
    the developer happens to have installed.
  - `Arduino Nano ESP32` declares `BOARD_PORTENTA`, which COMPILES and then
    swaps gateway and subnet at runtime.

Two of those three are silent at compile time.  So the rule here is the
opposite of a fallback: an unrecognised target is a hard `#error`.  A build
that stops with "add a branch" is strictly better than a device that serves
the wrong subnet, and there is no sensible default for "which chip's network
stack is this".

ONE LISTENER PER PROTOCOL, ONE POOL OF CLIENTS
----------------------------------------------
Each protocol declares its own `Listener` with its own port (4840, 102), but
they share one slot pool.  Slots are cheap -- an Arduino `Client` handle, not a
protocol buffer -- and sharing means the total is visible in one number rather
than being whatever two independent tables happen to add up to.

WHAT THIS SEAM DOES NOT DO
--------------------------
It does not bring the interface up.  By the time the PLC is running, the
network is already configured by the Modbus TCP layer (`mbconfig_*_iface`)
from the project's network screen — one DHCP lease, one static IP, one MAC.
`begin()` only opens a listening socket on top of that.  A second
`Ethernet.begin()` / `WiFi.begin()` here would re-init the interface out from
under Modbus and, on a static-IP build, produce two claims to one address.
*/

#ifndef BAREMETAL_NET_H
#define BAREMETAL_NET_H

#include "opcua_config.h"
#include "s7comm_config.h"

/** True when at least one protocol server needs a listening socket. With both
 *  disabled this entire file is empty, so a project with neither costs nothing
 *  -- which is the property that has to hold for every target that will never
 *  run either. */
#define BM_NET_ENABLED (OPCUA_ENABLED || S7COMM_ENABLED)

#if BM_NET_ENABLED

#include <Arduino.h>
#include <Client.h>
#include <stdint.h>

// The generated `defines.h` carries the board identity (BOARD_LOGO8, ...) and
// the interface kind (MBTCP_ETHERNET / MBTCP_WIFI) that the adapter selection
// below keys on.  It has NO include guard, so the project routes it through
// exactly one path — `modbus_config.h` — and every gated TU picks it up from
// there (see the rule in modbus_config.h and ARCHITECTURE.md).  This is a
// dependency on the BUILD CONFIGURATION, not on Modbus: without it every macro
// below is invisible and the #error at the bottom fires on a target that is
// actually supported.
#include "modbus_config.h"

// ---------------------------------------------------------------------------
// Adapter selection.  The ONLY board-conditional block in the OPC-UA layer.
//
// Ordering is deliberate: the most specific target first, the interface-kind
// defines (which come from the project's network screen via defines.h) last,
// and a hard stop when nothing matches.
// ---------------------------------------------------------------------------
#if defined(BOARD_LOGO8)
    // Energia lwIP <Ethernet.h>.  Deliberately WITHOUT <SPI.h>: there is no
    // SPI Ethernet shield on this variant and the core's <SPI.h> hard-errors
    // ("LauncPad not supported"), which is the same trap modbus_tcp.h
    // documents at its own LOGO8 branch.
    #include <Ethernet.h>
    typedef EthernetServer bm_server_impl_t;
    typedef EthernetClient bm_client_impl_t;

#elif defined(BOARD_ESP32)
    // Covers both interfaces on purpose: on the ESP32 the RMII Ethernet MAC
    // and the Wi-Fi station share one lwIP netif, so `WiFiServer` is the
    // listening socket for either.  There is no `EthernetServer` in this
    // core, which is exactly why the generic branch cannot serve it.
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
    // Generic WIZnet-style SPI Ethernet shield.  Reached only by targets that
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
    #error "baremetal_net: no network adapter for this target. Add a branch to baremetal_net.h keyed on the target's capability define -- do NOT add a fallback (see the header comment for what fallbacks cost)."
#endif

// ---------------------------------------------------------------------------
// Slot budget.
//
// A slot is an Arduino `Client` handle, NOT a protocol buffer -- OPC-UA's 8 KB
// receive buffer lives once in the ConnectionManager, and S7's PDU pair lives
// in the S7 server. So this is sized for TCP CHURN, not for sessions, and
// slots are cheap enough to be generous with.
//
// OPC-UA asks for maxSessions + 5. It used to ask for maxSessions + 1 = 2,
// which made the table full whenever one live connection overlapped one
// not-yet-reaped one -- and a full table makes accept() stop() the incoming
// connection, which a client sees as a failed handshake. Measured as exactly
// every other sequential connect failing.
//
// S7 asks for maxClients + 1, so a connection arriving at the ceiling can be
// accepted and refused politely rather than dropped at the TCP layer.
// ---------------------------------------------------------------------------
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
 *  assignable across cores -- an array of them initialised from a brace list
 *  compiles on some and not others. Each protocol declaring its own instance
 *  sidesteps that entirely, and makes the port visible where the protocol is.
 *
 *  Accepted clients go into the SHARED pool, so `release()` and `can_send()`
 *  are free functions: by the time you hold a `Client*` it no longer matters
 *  which listener produced it. */
class Listener
{
public:
    /** `reserve` is how many slots this listener may ALWAYS have, even when
     *  another protocol is churning through connections.
     *
     *  The pool is shared because slots are cheap and one number is easier to
     *  reason about than two. But shared without a floor means a protocol
     *  reconnecting in a burst can take every free slot, and the other one is
     *  refused until it lets go -- which is not theoretical: an OPC-UA session
     *  drop, which reconnects hard, was measured refusing S7 connections for
     *  the moment it took.
     *
     *  So each listener keeps a floor and competes for the rest. Below its
     *  reserve a listener is always served; above it, it takes from what is
     *  free. Set it to the protocol's own client ceiling. */
    Listener(uint16_t port, uint8_t reserve);

    /** Open the socket. Does NOT configure the interface -- see the header
     *  comment. Idempotent; returns false only if the port could not be
     *  opened. */
    bool begin();

    /** Next newly-connected client on THIS listener, or nullptr.
     *
     *  The returned pointer is to shared-pool storage, so it stays valid until
     *  `release()`. It is deliberately NOT a `Client` by value: the concrete
     *  `accept()` on every Arduino server returns a temporary, and a `Client*`
     *  into a temporary is the kind of dangling pointer that works in testing
     *  and fails under load. */
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

/** Can `need` bytes be queued on `client` right now WITHOUT blocking?
 *
 *  Arduino's abstract `Client` has no such query -- `availableForWrite()` is
 *  declared on the concrete classes, not on the base -- so the seam has to ask
 *  on the caller's behalf. That is exactly the kind of per-family knowledge
 *  this file exists to contain.
 *
 *  It matters because `write()` blocks: Energia's spins on `delay(1)` until
 *  lwIP's send buffer drains, which inside a scan cycle is unbounded. Measured
 *  as a 1.27 SECOND stall in one iteration against a 20 ms cycle. Nothing in a
 *  PLC may wait on a remote peer's ACK. */
bool can_send(const Client* client, size_t need);

/** Service the stack. A no-op on cores whose driver is interrupt-driven; the
 *  hook exists for stacks that need cooperative polling, so callers never have
 *  to know which kind they are on. */
void poll();

/** Close every client in the pool. Listeners close themselves. */
void close_all();

} // namespace bm_net

#endif // BM_NET_ENABLED
#endif // BAREMETAL_NET_H
