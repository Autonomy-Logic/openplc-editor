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

/** How many nodes the project declared. Compile-time constant; the address
 *  space never changes at runtime, which is the whole premise of the flash
 *  nodestore. */
UA_UInt16 opcua_nodes_count(void);

/** The numeric NodeId of the `index`-th declared node, for iteration. */
UA_UInt16 opcua_nodes_id_at(UA_UInt16 index);

/** Fill `out` with the node whose numeric id is `numeric_id`, or return false
 *  if no such node was declared.
 *
 *  Everything the node needs that is constant lives in flash and is POINTED AT
 *  rather than copied: the browse name, the display name text, the reference
 *  arrays, the type id. Only the fixed-size `UA_VariableNode` shell is written,
 *  which is what makes a materialised node cost a pool slot rather than the
 *  ~476 B/node the ziptree charged.
 *
 *  The caller owns `out` and must never let open62541 free its contents --
 *  see opcua_nodestore.cpp, which is the only intended caller. */
bool opcua_nodes_materialise(UA_UInt16 numeric_id, UA_UInt16 ns, UA_VariableNode* out);

/** Release what opcua_nodes_materialise() allocated (the reference arrays).
 *  Safe to call twice and on a zeroed node. */
void opcua_nodes_dematerialise(UA_VariableNode* node);

#endif // OPCUA_ENABLED
#endif // OPCUA_NODES_H
