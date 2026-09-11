/*
opcua_nodes.h - address-space construction
Copyright (C) 2026 Autonomy Logic
*/

#ifndef OPCUA_NODES_H
#define OPCUA_NODES_H

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <open62541.h>

/** Register a namespace and add every row of OPCUA_NODES[] to it as a
 *  data-source variable. Returns the first failure, because an address space
 *  that is missing nodes is worse than one that failed to build: the client
 *  would see a plausible but incomplete tree. */
UA_StatusCode opcua_nodes_populate(UA_Server* server, UA_UInt16* out_ns_index);

#endif // OPCUA_ENABLED
#endif // OPCUA_NODES_H
