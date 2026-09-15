/*
opcua_log.h - telnet debug log for OPC-UA bring-up
Copyright (C) 2026 Autonomy Logic

A line-oriented log served on TCP port 23, so a developer can `telnet
<device> 23` and watch what the OPC-UA server is doing. The LOGO! has no
accessible serial port and no display worth logging to, which leaves the
network as the only channel — and without one, diagnosing a protocol failure
on-device is guesswork.

Gated behind OPCUA_DEBUG_LOG and compiled out by default: it costs flash, it
holds a socket, and it prints internals no production device should publish.
*/

#ifndef OPCUA_LOG_H
#define OPCUA_LOG_H

#include "opcua_config.h"

#ifndef OPCUA_DEBUG_LOG
#define OPCUA_DEBUG_LOG 0
#endif

#if OPCUA_ENABLED && OPCUA_DEBUG_LOG

void opcua_log_begin(void);
/** Service the log socket. Cheap; call it from the scan loop. */
void opcua_log_poll(void);
/** printf-style. Lines are dropped, never blocking, when nobody is attached —
 *  a debug channel that can stall the scan cycle is worse than no channel. */
void opcua_logf(const char* fmt, ...);

/** Dump lwIP's own pool/heap counters.
 *
 *  The question "why did the listener die under load" is not answerable from
 *  our side of the stack: the sockets are gone but Modbus still serves, which
 *  points below us. lwIP keeps the numbers already (LWIP_STATS defaults on,
 *  MEMP_STATS/MEM_STATS derive to 1) — they just have to be read out. */
void opcua_log_netstats(const char* tag);

#define OPCUA_LOG(...) opcua_logf(__VA_ARGS__)

#else

#define OPCUA_LOG(...) do { } while (0)
static inline void opcua_log_netstats(const char* tag) { (void)tag; }
static inline void opcua_log_begin(void) { }
static inline void opcua_log_poll(void)  { }

#endif

#endif // OPCUA_LOG_H
