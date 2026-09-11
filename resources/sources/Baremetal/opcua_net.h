/*
opcua_net.h - the ONE place the OPC-UA server names a concrete network class
Copyright (C) 2026 Autonomy Logic

Everything above this header is typed on Arduino's abstract `Client`, so the
OPC-UA server, its open62541 ConnectionManager and its transport logic contain
no board macros at all.  Adding a network family is this file and nothing else.

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

WHAT THIS SEAM DOES NOT DO
--------------------------
It does not bring the interface up.  By the time the PLC is running, the
network is already configured by the Modbus TCP layer (`mbconfig_*_iface`)
from the project's network screen — one DHCP lease, one static IP, one MAC.
`begin()` only opens a listening socket on top of that.  A second
`Ethernet.begin()` / `WiFi.begin()` here would re-init the interface out from
under Modbus and, on a static-IP build, produce two claims to one address.
*/

#ifndef OPCUA_NET_H
#define OPCUA_NET_H

#include "opcua_config.h"

#if OPCUA_ENABLED

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
    typedef EthernetServer opcua_server_impl_t;
    typedef EthernetClient opcua_client_impl_t;

#elif defined(BOARD_ESP32)
    // Covers both interfaces on purpose: on the ESP32 the RMII Ethernet MAC
    // and the Wi-Fi station share one lwIP netif, so `WiFiServer` is the
    // listening socket for either.  There is no `EthernetServer` in this
    // core, which is exactly why the generic branch cannot serve it.
    #include <WiFi.h>
    typedef WiFiServer opcua_server_impl_t;
    typedef WiFiClient opcua_client_impl_t;

#elif defined(BOARD_ESP8266)
    #include <ESP8266WiFi.h>
    typedef WiFiServer opcua_server_impl_t;
    typedef WiFiClient opcua_client_impl_t;

#elif defined(BOARD_PICOW)
    #include <WiFi.h>
    typedef WiFiServer opcua_server_impl_t;
    typedef WiFiClient opcua_client_impl_t;

#elif defined(BOARD_PORTENTA)
    #include <Ethernet.h>
    typedef EthernetServer opcua_server_impl_t;
    typedef EthernetClient opcua_client_impl_t;

#elif defined(MBTCP_ETHERNET)
    // Generic WIZnet-style SPI Ethernet shield.  Reached only by targets that
    // genuinely use one, because every chip with its own MAC is named above.
    #include <SPI.h>
    #include <Ethernet.h>
    typedef EthernetServer opcua_server_impl_t;
    typedef EthernetClient opcua_client_impl_t;

#elif defined(MBTCP_WIFI)
    #include <SPI.h>
    #include <WiFi.h>
    typedef WiFiServer opcua_server_impl_t;
    typedef WiFiClient opcua_client_impl_t;

#else
    #error "opcua_net: no network adapter for this target. Add a branch to opcua_net.h keyed on the target's capability define -- do NOT add a fallback (see the header comment for what fallbacks cost)."
#endif

// One slot per session, plus one so a connection arriving at the session
// ceiling can be accepted and rejected politely (an OPC-UA client that is
// refused at the TCP layer retries in a tight loop; one that gets a clean
// service fault backs off).
// Slots are cheap: each one is an Arduino Client object, NOT a session
// buffer pair (the 8 KB receive buffer lives once in the ConnectionManager).
// So this is sized for TCP churn, not for sessions.
//
// It used to be maxSessions + 1 = 2, which made the table full whenever one
// live connection overlapped one not-yet-reaped one — and a full table makes
// accept() stop() the incoming connection, which the client sees as a failed
// handshake. Measured as exactly every other sequential connect failing.
#define OPCUA_NET_MAX_CLIENTS (OPCUA_MAX_SESSIONS + 5)

namespace opcua_net {

/** Open the listening socket.  Does NOT configure the interface — see the
 *  header comment.  Returns false if the port could not be opened. */
bool begin(uint16_t port);

/** Next newly-connected client, or nullptr.
 *
 *  The returned pointer is to storage this module owns, so it stays valid
 *  until `release()` or `end()`.  It is deliberately NOT a `Client` by value:
 *  the concrete `available()` on every Arduino server returns a temporary,
 *  and a `Client*` into a temporary is the kind of dangling pointer that
 *  works in testing and fails under load. */
Client* accept();

/** Hand a client slot back.  Closes the connection if still open. */
void release(Client* client);

/** Is `client` still the SAME TCP connection it was when accept() returned it?
 *
 *  This is not a redundant `connected()`. Every Arduino network stack hands
 *  out a client object that is a NON-OWNING HANDLE onto a slot in the
 *  server's own fixed client table — Energia's EthernetClient wraps a pointer
 *  into `EthernetServer::clients[]`, and the WiFi/WizNet clients wrap a
 *  socket index. Hold one across the peer's disconnect and the stack is free
 *  to drop the NEXT inbound connection into that same slot, at which point
 *  the handle silently re-points: `connected()` is true again, `available()`
 *  reports the new peer's bytes, and the caller reads one connection's data
 *  as though it belonged to another.
 *
 *  Measured on hardware: sequential OPC-UA connections alternated ACK / ERR
 *  forever, because every second Hello was delivered on the previous
 *  connection's already-established SecureChannel. Four accepts served eight
 *  connections.
 *
 *  So identity, not just liveness, has to be tracked — and it has to be
 *  tracked HERE, because the remote port that establishes it is the one piece
 *  of per-stack knowledge this seam exists to contain. */
bool alive(const Client* client);

/** Service the stack.  A no-op on cores whose driver is interrupt-driven;
 *  the hook exists for stacks that need cooperative polling, so callers never
 *  have to know which kind they are on. */
void poll();

/** Close the listener and every open client. */
void end();

} // namespace opcua_net

#endif // OPCUA_ENABLED
#endif // OPCUA_NET_H
