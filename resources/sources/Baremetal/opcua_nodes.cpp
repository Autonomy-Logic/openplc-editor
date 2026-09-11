/*
opcua_nodes.cpp - the address space and the data plane
Copyright (C) 2026 Autonomy Logic

Turns the generated OPCUA_NODES[] table into open62541 variable nodes whose
values come straight from the PLC, with no copy in between.

Every node is a DATA SOURCE, not a value-holding variable. That is the whole
data plane: a read calls strucpp::debug::handle_read(arr, elem, ...) against
the table the compiler already emitted for the debugger, so the client always
sees the live value, there is no shadow copy to keep in sync, and there is no
mirroring loop running at scan rate. The (arr, elem) pair in each row is the
same coordinate the editor resolved from debug-map.json, so a variable cannot
resolve differently here than it does for Runtime v4.
*/

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <Arduino.h>

#include <open62541.h>

#include "opcua_nodes.h"
#include "opcua_nodestore.h"
#include "opcua_log.h"
#include "opcua_types.h"

// Arduino/Energia define min / max / abs / round as preprocessor macros, and
// they wreck the std headers the strucpp runtime pulls in behind
// debug_dispatch.hpp — iec_traits.hpp uses std::numeric_limits<T>::min(),
// which becomes "macro min requires 2 arguments". Same ordering rule
// generateCBlocksCode enforces for user C blocks: <Arduino.h>, then the
// undefs, then the strucpp headers.
#undef min
#undef max
#undef abs
#undef round

// The strucpp debug table. Same accessors the Modbus debugger uses.
#include "debug_dispatch.hpp"

namespace {

/** TypeTag -> UA_DataType index.
 *
 *  Indexed by the tag stored in each OPCUA_NODES[] row, which is an ABI with
 *  generate-opcua-header.ts and with opcua_types.py. Keep all three in step:
 *  a mismatch here hands the encoder the wrong byte width and the client
 *  receives plausible garbage rather than an error.
 *
 *  TIME / DATE / TOD / DT are IEC time types with no direct OPC-UA scalar of
 *  the same width; they are exposed as the integers they already are on the
 *  wire rather than converted, so no precision is invented. STRING / WSTRING
 *  are not exposed at all yet — handle_read returns 0 for them (the runtime
 *  calls them a "string stub"), so publishing them would mean publishing
 *  nothing. */
const UA_UInt32 kTagToUaType[] = {
    UA_TYPES_BOOLEAN,  // TAG_BOOL
    UA_TYPES_SBYTE,    // TAG_SINT
    UA_TYPES_BYTE,     // TAG_USINT
    UA_TYPES_INT16,    // TAG_INT
    UA_TYPES_UINT16,   // TAG_UINT
    UA_TYPES_INT32,    // TAG_DINT
    UA_TYPES_UINT32,   // TAG_UDINT
    UA_TYPES_INT64,    // TAG_LINT
    UA_TYPES_UINT64,   // TAG_ULINT
    UA_TYPES_FLOAT,    // TAG_REAL
    UA_TYPES_DOUBLE,   // TAG_LREAL
    UA_TYPES_BYTE,     // TAG_BYTE
    UA_TYPES_UINT16,   // TAG_WORD
    UA_TYPES_UINT32,   // TAG_DWORD
    UA_TYPES_UINT64,   // TAG_LWORD
    UA_TYPES_INT64,    // TAG_TIME  (IEC duration, 100 ns-agnostic integer)
    UA_TYPES_INT64,    // TAG_DATE
    UA_TYPES_INT64,    // TAG_TOD
    UA_TYPES_INT64,    // TAG_DT
};
constexpr uint8_t kTagCount = sizeof(kTagToUaType) / sizeof(kTagToUaType[0]);

/** The row a node's callbacks belong to. open62541 hands back the nodeContext
 *  we registered, so the callbacks stay free of any lookup. */
const opcua_node_t* row_from_context(void* nodeContext)
{
    return static_cast<const opcua_node_t*>(nodeContext);
}

UA_StatusCode read_node(UA_Server* server, const UA_NodeId* sessionId, void* sessionContext,
                        const UA_NodeId* nodeId, void* nodeContext,
                        UA_Boolean includeSourceTimeStamp, const UA_NumericRange* range,
                        UA_DataValue* value)
{
    (void)server; (void)sessionId; (void)sessionContext; (void)nodeId;
    // IndexRange on a scalar is meaningless; refusing is what the spec asks
    // for rather than silently ignoring the range.
    if (range != nullptr)
        return UA_STATUSCODE_BADINDEXRANGEINVALID;

    const opcua_node_t* row = row_from_context(nodeContext);
    if (row == nullptr || row->tag >= kTagCount)
        return UA_STATUSCODE_BADINTERNALERROR;

    // 8 bytes covers every scalar in the table above.
    uint8_t buf[8] = {0};
    const uint16_t n = strucpp::debug::handle_read(row->arr, row->elem, buf);
    if (n == 0)
        return UA_STATUSCODE_BADNODATA;   // out of bounds, or a string stub

    UA_Variant_setScalarCopy(&value->value, buf, &UA_TYPES[kTagToUaType[row->tag]]);
    value->hasValue = true;
    if (includeSourceTimeStamp)
    {
        // The value was read from the PLC just now, so "now" is honest — even
        // though the wall clock itself is a build epoch plus uptime on a part
        // with no RTC (see opcua_arch.cpp).
        value->sourceTimestamp = UA_DateTime_now();
        value->hasSourceTimestamp = true;
    }
    return UA_STATUSCODE_GOOD;
}

UA_StatusCode write_node(UA_Server* server, const UA_NodeId* sessionId, void* sessionContext,
                         const UA_NodeId* nodeId, void* nodeContext,
                         const UA_NumericRange* range, const UA_DataValue* value)
{
    (void)server; (void)sessionId; (void)sessionContext; (void)nodeId;
    if (range != nullptr)
        return UA_STATUSCODE_BADINDEXRANGEINVALID;

    const opcua_node_t* row = row_from_context(nodeContext);
    if (row == nullptr || row->tag >= kTagCount)
        return UA_STATUSCODE_BADINTERNALERROR;
    if (value == nullptr || !value->hasValue || value->value.data == nullptr)
    {
        OPCUA_LOG("[ua] write %s: no value", row->browse_name);
        return UA_STATUSCODE_BADTYPEMISMATCH;
    }

    // Insist on the exact type. Accepting a near-miss and coercing it would
    // mean a client writing an Int32 to a BOOL silently sets something, and
    // the PLC is the wrong place to be lenient about that.
    const UA_DataType* want = &UA_TYPES[kTagToUaType[row->tag]];
    if (value->value.type != want)
    {
        OPCUA_LOG("[ua] write %s: type mismatch", row->browse_name);
        return UA_STATUSCODE_BADTYPEMISMATCH;
    }

    const uint16_t width = strucpp::debug::handle_size(row->arr, row->elem);
    if (width == 0 || width > 8)
        return UA_STATUSCODE_BADNOTWRITABLE;

    const uint8_t status = strucpp::debug::handle_write(
        row->arr, row->elem, static_cast<const uint8_t*>(value->value.data), width);
    OPCUA_LOG("[ua] write %s arr=%u elem=%u w=%u status=0x%02x",
              row->browse_name, (unsigned)row->arr, (unsigned)row->elem,
              (unsigned)width, (unsigned)status);

    // STATUS_OK is 0x7E, NOT zero — the debugger's status codes are chosen so
    // the editor's wire parsers can tell them apart, and zero is not one of
    // them. Comparing against 0 reported every SUCCESSFUL write to the client
    // as BadNotWritable while the value had in fact landed in the PLC.
    return (status == strucpp::debug::STATUS_OK)
               ? UA_STATUSCODE_GOOD
               : UA_STATUSCODE_BADNOTWRITABLE;
}

/** Any-role writability.
 *
 *  The per-role r/w/rw bitmap in each row is the real access-control answer,
 *  but enforcing it per session needs the authenticated role, which arrives
 *  with username auth (still to come). Until then a node is advertised
 *  writable if ANY role may write it, and read-only otherwise — so a
 *  read-only variable is never presented as writable, which is the direction
 *  that matters. */
bool any_role_may_write(uint8_t perms)
{
    return opcua_can_write(perms, OPCUA_ROLE_VIEWER)
        || opcua_can_write(perms, OPCUA_ROLE_OPERATOR)
        || opcua_can_write(perms, OPCUA_ROLE_ENGINEER);
}

} // namespace

/* ---------------------------------------------------------------------------
 * Materialisation for the flash nodestore
 *
 * The address space is fixed when the project is compiled and never changes,
 * so the ziptree's per-node RAM was paying to store something already `const`.
 * Measured: 476 B of arena per node, 19,032 B for 40 nodes, and a Browse over
 * 40 nodes then failed with BadOutOfMemory because the arena had nothing
 * contiguous left. These functions let opcua_nodestore.cpp hand open62541 a
 * node built on demand into a small fixed pool instead.
 * ------------------------------------------------------------------------- */

namespace {

/** Build this node's two references -- forward HasTypeDefinition to
 *  BaseDataVariableType, inverse Organizes from the Objects folder.
 *
 *  They are IDENTICAL for every node, so the obvious move is one shared static
 *  instance. That is a trap: open62541 grows a node's reference array with
 *  UA_realloc, and it does exactly that when a reference is added naming this
 *  node as the target. Realloc on a shared static -- or on a pointer into
 *  flash -- is undefined behaviour, so each materialised node gets its own
 *  allocation instead. ~40 B, bounded by the pool size, freed on release.
 *
 *  Discarding any edit made to it is not a loss: flash is the truth, and the
 *  inverse Organizes the server would be trying to add is already here. */
UA_NodeId g_id_basedatavariabletype = UA_NODEID_NUMERIC(0, UA_NS0ID_BASEDATAVARIABLETYPE);
UA_NodeId g_id_objectsfolder        = UA_NODEID_NUMERIC(0, UA_NS0ID_OBJECTSFOLDER);

bool build_refs(UA_NodeHead* h, const char* name)
{
    UA_NodeReferenceKind* kinds =
        (UA_NodeReferenceKind*)UA_calloc(2, sizeof(UA_NodeReferenceKind));
    UA_ReferenceTarget* targets =
        (UA_ReferenceTarget*)UA_calloc(2, sizeof(UA_ReferenceTarget));
    UA_LocalizedTextListEntry* dn =
        (UA_LocalizedTextListEntry*)UA_calloc(1, sizeof(UA_LocalizedTextListEntry));
    if (kinds == nullptr || targets == nullptr || dn == nullptr)
    {
        UA_free(kinds); UA_free(targets); UA_free(dn);
        return false;
    }

    // The text points into flash; only the list cell is allocated.
    dn->next = nullptr;
    dn->localizedText.locale = UA_STRING_NULL;
    dn->localizedText.text   = UA_STRING((char*)name);
    h->displayName = dn;

    // The two target ids are namespace-zero constants shared by every node.
    // Sharing them is safe where sharing the reference ARRAY is not: open62541
    // grows the array with UA_realloc, but never writes through a target id.
    targets[0].targetId       = UA_NodePointer_fromNodeId(&g_id_basedatavariabletype);
    targets[0].targetNameHash = 0;
    targets[1].targetId       = UA_NodePointer_fromNodeId(&g_id_objectsfolder);
    targets[1].targetNameHash = 0;

    kinds[0].targets.array      = &targets[0];
    kinds[0].targetsSize        = 1;
    kinds[0].hasRefTree         = false;
    kinds[0].referenceTypeIndex = UA_REFERENCETYPEINDEX_HASTYPEDEFINITION;
    kinds[0].isInverse          = false;

    kinds[1].targets.array      = &targets[1];
    kinds[1].targetsSize        = 1;
    kinds[1].hasRefTree         = false;
    kinds[1].referenceTypeIndex = UA_REFERENCETYPEINDEX_ORGANIZES;
    kinds[1].isInverse          = true;

    h->references     = kinds;
    h->referencesSize = 2;
    return true;
}

} // namespace

UA_UInt16 opcua_nodes_count(void)
{
    return (UA_UInt16)OPCUA_NODE_COUNT;
}

UA_UInt16 opcua_nodes_id_at(UA_UInt16 index)
{
#if OPCUA_NODE_COUNT > 0
    if (index < OPCUA_NODE_COUNT)
        return OPCUA_NODES[index].node_id;
#else
    (void)index;
#endif
    return 0;
}

bool opcua_nodes_materialise(UA_UInt16 numeric_id, UA_UInt16 ns, UA_VariableNode* out)
{
#if OPCUA_NODE_COUNT > 0
    const opcua_node_t* row = nullptr;
    for (uint16_t i = 0; i < OPCUA_NODE_COUNT; i++)
    {
        if (OPCUA_NODES[i].node_id == numeric_id)
        {
            row = &OPCUA_NODES[i];
            break;
        }
    }
    if (row == nullptr || row->tag >= kTagCount)
        return false;

    memset(out, 0, sizeof(*out));

    UA_NodeHead* h = &out->head;
    h->nodeId     = UA_NODEID_NUMERIC(ns, row->node_id);
    h->nodeClass  = UA_NODECLASS_VARIABLE;
    // Names point INTO FLASH. Nothing may free them, which is why deleteNode
    // in the nodestore must never run over one of these.
    h->browseName.namespaceIndex = ns;
    h->browseName.name  = UA_STRING((char*)row->browse_name);
    // displayName is a singly-linked list of localised texts, not a scalar.
    // One entry, allocated with the references so release frees them together.
    h->displayName = nullptr;
    if (!build_refs(h, row->browse_name))
        return false;
    // Read-only ATTRIBUTES. The value is writable through the callback below
    // when permissions allow; everything else about the node is fixed at
    // compile time, and a zero writeMask makes the server say so before it
    // ever reaches the shared, non-copied data above.
    h->writeMask        = 0;
    h->context          = (void*)row;

    out->dataType   = UA_TYPES[kTagToUaType[row->tag]].typeId;
    out->valueRank  = UA_VALUERANK_SCALAR;
    out->accessLevel = UA_ACCESSLEVELMASK_READ;
    if (any_role_may_write(row->perms))
        out->accessLevel |= UA_ACCESSLEVELMASK_WRITE;

    out->valueSourceType         = UA_VALUESOURCETYPE_CALLBACK;
    out->valueSource.callback.read  = read_node;
    out->valueSource.callback.write = write_node;
    return true;
#else
    (void)numeric_id; (void)ns; (void)out;
    return false;
#endif
}

void opcua_nodes_dematerialise(UA_VariableNode* node)
{
    if (node == nullptr || node->head.references == nullptr)
        return;
    // Free in the shape build_refs() allocated, and only if the array still
    // looks like ours. If open62541 grew it, it did so with UA_realloc on our
    // own allocation, so freeing the array is still correct -- what we must
    // not do is free the per-target NodeIds twice.
    UA_NodeReferenceKind* kinds = node->head.references;
    if (kinds[0].targets.array != nullptr)
        UA_free(kinds[0].targets.array);   // the target ids are shared statics
    UA_free(kinds);
    UA_free(node->head.displayName);
    node->head.displayName    = nullptr;
    node->head.references     = nullptr;
    node->head.referencesSize = 0;
}

UA_StatusCode opcua_nodes_populate(UA_Server* server, UA_UInt16* out_ns_index)
{
    UA_UInt16 ns = UA_Server_addNamespace(server, OPCUA_NAMESPACE_URI);
    if (out_ns_index != nullptr)
        *out_ns_index = ns;

    // Swap the default nodestore for the flash-backed one now that the
    // namespace index is known. Namespace zero has already been built into the
    // inner store during server creation and is carried over untouched.
    UA_ServerConfig* cfg = UA_Server_getConfig(server);
    UA_Nodestore* flash = opcua_nodestore_new(cfg->nodestore, ns);
    if (flash == nullptr)
        return UA_STATUSCODE_BADOUTOFMEMORY;
    cfg->nodestore = flash;

#if OPCUA_NODE_COUNT > 0
    // The nodes themselves are already in flash and need no adding. What the
    // Objects folder does need is a forward reference to each of them, or a
    // Browse of Objects will not find them -- open62541 follows forward
    // references from the node being browsed. That is 8 B per node
    // (UA_ReferenceTarget) in the inner store, against the 476 B per node the
    // zip-tree charged to hold the node itself.
    for (uint16_t i = 0; i < OPCUA_NODE_COUNT; i++)
    {
        const opcua_node_t* row = &OPCUA_NODES[i];
        if (row->tag >= kTagCount)
            continue;   // unexposable type; the generator should have dropped it

        const UA_StatusCode rc = UA_Server_addReference(
            server,
            UA_NODEID_NUMERIC(0, UA_NS0ID_OBJECTSFOLDER),
            UA_NODEID_NUMERIC(0, UA_NS0ID_ORGANIZES),
            UA_EXPANDEDNODEID_NUMERIC(ns, row->node_id),
            true);
        // The matching inverse reference is already part of every flash node,
        // so the server trying to add it again is expected and harmless: the
        // edit lands on the materialised copy and is discarded on release.
        if (rc != UA_STATUSCODE_GOOD && rc != UA_STATUSCODE_BADDUPLICATEREFERENCENOTALLOWED)
        {
            OPCUA_LOG("[ns] addReference failed for node %u rc=0x%08lx",
                      (unsigned)row->node_id, (unsigned long)rc);
            return rc;
        }
    }
#endif
    return UA_STATUSCODE_GOOD;
}

#endif // OPCUA_ENABLED
