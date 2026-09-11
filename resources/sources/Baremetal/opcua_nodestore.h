/*
opcua_nodestore.h - read-only, flash-backed nodestore for the project's namespace
Copyright (C) 2026 Autonomy Logic

The baremetal address space is decided when the project is compiled and never
changes at runtime. Storing it in RAM therefore pays, per node, for something
that is already `const` in flash.

Measured on a LOGO! 8.2 with open62541's default zip-tree nodestore:

    2 nodes    30,840 -> 32,248 B arena
   40 nodes    30,840 -> 49,872 B arena      =  476 B/node

and at 40 nodes a Browse then failed outright with BadOutOfMemory -- 49,872 of
the 65,536 B arena was gone, the largest free block was 13,440 B, and there was
nowhere to build the response. So this is not an optimisation: without it the
server cannot serve a realistic address space at all.

This nodestore keeps the nodes in flash and materialises them on demand into a
small fixed pool, so the cost stops scaling with the node count. What remains
in RAM is the Objects folder's forward references, at 8 B per node
(UA_ReferenceTarget), instead of 476.

It wraps rather than replaces the default nodestore: namespace zero is large,
mutable during startup, and not ours, so anything that is not in the project's
namespace is delegated untouched.
*/

#ifndef OPCUA_NODESTORE_H
#define OPCUA_NODESTORE_H

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <open62541.h>

/** Wrap `inner` so that nodes in namespace `ns_index` come from flash.
 *
 *  Takes ownership of `inner`: freeing the returned nodestore frees it too,
 *  which is what open62541 will do on shutdown. Returns nullptr if the pool
 *  cannot be allocated, in which case the caller should keep using `inner`
 *  alone rather than run without an address space. */
UA_Nodestore* opcua_nodestore_new(UA_Nodestore* inner, UA_UInt16 ns_index);

/** Peak simultaneous materialised nodes, and how many times the pool was
 *  exhausted.
 *
 *  Exhaustion is the failure mode this design has to be watched for: the pool
 *  size rests on how many nodes open62541 holds at once, which is bounded by
 *  the OperationLimits but is not a contractual promise. It must fail loudly
 *  in test rather than quietly in the field. */
void opcua_nodestore_stats(uint16_t* out_high_water, uint32_t* out_exhausted);

#endif // OPCUA_ENABLED
#endif // OPCUA_NODESTORE_H
