/*
opcua_arch.h - the platform layer's own interface
Copyright (C) 2026 Autonomy Logic

Declares the honestly-named implementations. The _POSIX symbols open62541's
server_config_default insists on are one-line forwarders onto these, defined
at the bottom of opcua_arch.cpp — see the note there.
*/

#ifndef OPCUA_ARCH_H
#define OPCUA_ARCH_H

#include "opcua_config.h"

#if OPCUA_ENABLED

// Umbrella, not the nested paths: arduino-cli resolves a library by
// basename at src/ root, so <open62541/...> discovers nothing and the
// precompiled archive silently misses the link. See the header itself.
#include <open62541.h>

/** Non-blocking EventLoop driven from the PLC scan loop. `run()` ignores its
 *  timeout by design: sleeping would stop the PLC logic. */
UA_EventLoop* UA_EventLoop_new_Arduino(const UA_Logger* logger);

/** TCP ConnectionManager over `opcua_net.h`'s abstract `Client*` seam — no
 *  board macros, no sockets. */
UA_ConnectionManager* UA_ConnectionManager_new_Arduino_TCP(const UA_String eventSourceName);

/** Service one ConnectionManager: accept new clients, drain readable ones,
 *  reap closed ones. Called by the EventLoop's `run()` for each registered
 *  connection manager, so the CM needs no timer of its own. */
void opcua_cm_poll(UA_ConnectionManager* cm);

#endif // OPCUA_ENABLED
#endif // OPCUA_ARCH_H
