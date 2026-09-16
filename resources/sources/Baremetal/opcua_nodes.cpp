/*
opcua_nodes.cpp - the address space and the data plane
Copyright (C) 2026 Autonomy Logic

Turns the generated OPCUA_NODES[] table into open62541 variable nodes whose
values come straight from the PLC, with no copy in between. Every node is a data
source: a read calls openplc_debug_read(arr, elem, ...) against the table the
compiler emitted for the debugger, so there is no shadow copy and no mirroring
loop at scan rate.
*/

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <Arduino.h>

#include <open62541.h>
#include <open62541_arduino.h>

#include "opcua_nodes.h"
#include "opcua_log.h"
#include "opcua_types.h"

// The debug table, reached through the extern "C" shims rather than by including
// debug_dispatch.hpp -- the same route modbus_debug.cpp takes. This TU uses the
// core's default C++ standard while the strucpp runtime needs gnu++17 and lives
// in a precompiled archive, so including its templates here is an ABI break.
#include "arduino_runtime_glue.h"

namespace {

/** TypeTag -> UA_DataType index.
 *
 *  Indexed by the tag stored in each OPCUA_NODES[] row, an ABI with
 *  generate-opcua-header.ts and opcua_types.py. Keep all three in step: a
 *  mismatch hands the encoder the wrong byte width.
 *
 *  TIME / DATE / TOD / DT have no OPC-UA scalar of the same width, so they are
 *  exposed as the integers they already are on the wire. STRING / WSTRING are
 *  not exposed: handle_read returns 0 for them. */
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
    // IndexRange on a scalar is meaningless; refusing is what the spec asks for.
    if (range != nullptr)
        return UA_STATUSCODE_BADINDEXRANGEINVALID;

    const opcua_node_t* row = row_from_context(nodeContext);
    if (row == nullptr || row->tag >= kTagCount)
        return UA_STATUSCODE_BADINTERNALERROR;

    // 8 bytes covers every scalar in the table above.
    uint8_t buf[8] = {0};
    const uint16_t n = openplc_debug_read(row->arr, row->elem, buf);
    if (n == 0)
        return UA_STATUSCODE_BADNODATA;   // out of bounds, or a string stub

    UA_Variant_setScalarCopy(&value->value, buf, &UA_TYPES[kTagToUaType[row->tag]]);
    value->hasValue = true;
    if (includeSourceTimeStamp)
    {
        // The value was read from the PLC just now, so "now" is honest, even
        // though the wall clock is a build epoch plus uptime on a part with no RTC.
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

    // Insist on the exact type: coercing a near-miss would let a client writing
    // an Int32 to a BOOL silently set something.
    const UA_DataType* want = &UA_TYPES[kTagToUaType[row->tag]];
    if (value->value.type != want)
    {
        OPCUA_LOG("[ua] write %s: type mismatch", row->browse_name);
        return UA_STATUSCODE_BADTYPEMISMATCH;
    }

    const uint16_t width = openplc_debug_size(row->arr, row->elem);
    if (width == 0 || width > 8)
        return UA_STATUSCODE_BADNOTWRITABLE;

    const uint8_t status = openplc_debug_write(
        row->arr, row->elem, static_cast<const uint8_t*>(value->value.data), width);
    OPCUA_LOG("[ua] write %s arr=%u elem=%u w=%u status=0x%02x",
              row->browse_name, (unsigned)row->arr, (unsigned)row->elem,
              (unsigned)width, (unsigned)status);

    // STATUS_OK is 0x7E, not zero -- the debugger's status codes are chosen so
    // the editor's wire parsers can tell them apart. Comparing against 0 reports
    // every successful write to the client as BadNotWritable.
    return (status == OPENPLC_DEBUG_STATUS_OK)
               ? UA_STATUSCODE_GOOD
               : UA_STATUSCODE_BADNOTWRITABLE;
}

/** Any-role writability.
 *
 *  The per-role bitmap in each row is the real access-control answer, but
 *  enforcing it per session needs the authenticated role. Until then a node is
 *  advertised writable if any role may write it, so a read-only variable is
 *  never presented as writable. */
bool any_role_may_write(uint8_t perms)
{
    return opcua_can_write(perms, OPCUA_ROLE_VIEWER)
        || opcua_can_write(perms, OPCUA_ROLE_OPERATOR)
        || opcua_can_write(perms, OPCUA_ROLE_ENGINEER);
}

} // namespace

/* ---------------------------------------------------------------------------
 * Materialisation for the flash nodestore. The address space is fixed at
 * compile time, so the ziptree's per-node RAM (measured 476 B of arena per node)
 * was storing something already `const`. These build a node on demand instead.
 * ------------------------------------------------------------------------- */

namespace {

/** Build this node's two references -- forward HasTypeDefinition to
 *  BaseDataVariableType, inverse Organizes from the Objects folder.
 *
 *  They are identical for every node, but one shared static is a trap:
 *  open62541 grows a node's reference array with UA_realloc when a reference
 *  naming this node as target is added, and realloc on a shared static or on a
 *  pointer into flash is undefined behaviour. Each materialised node therefore
 *  gets its own allocation, freed on release. */
UA_NodeId g_id_basedatavariabletype = UA_NODEID_NUMERIC(0, UA_NS0ID_BASEDATAVARIABLETYPE);
UA_NodeId g_id_objectsfolder        = UA_NODEID_NUMERIC(0, UA_NS0ID_OBJECTSFOLDER);

bool build_refs(UA_NodeHead* h, const char* name)
{
    UA_NodeReferenceKind* kinds =
        (UA_NodeReferenceKind*)UA_calloc(2, sizeof(UA_NodeReferenceKind));
    // One allocation PER KIND, not one shared array carved in two. open62541
    // may append to a kind's target array with UA_realloc, and realloc is only
    // defined on the start of a block -- handing kinds[1] an interior pointer
    // into a shared allocation was undefined behaviour waiting on whether the
    // SDK happened to take that path. It does take it: opcua_nodes_populate()
    // asks the server to add the inverse Organizes reference, and only the
    // duplicate rejection stops the append today.
    UA_ReferenceTarget* type_target =
        (UA_ReferenceTarget*)UA_calloc(1, sizeof(UA_ReferenceTarget));
    UA_ReferenceTarget* organizes_target =
        (UA_ReferenceTarget*)UA_calloc(1, sizeof(UA_ReferenceTarget));
    UA_LocalizedTextListEntry* dn =
        (UA_LocalizedTextListEntry*)UA_calloc(1, sizeof(UA_LocalizedTextListEntry));
    if (kinds == nullptr || type_target == nullptr ||
        organizes_target == nullptr || dn == nullptr)
    {
        UA_free(kinds); UA_free(type_target); UA_free(organizes_target); UA_free(dn);
        return false;
    }

    // The text points into flash; only the list cell is allocated.
    dn->next = nullptr;
    dn->localizedText.locale = UA_STRING_NULL;
    dn->localizedText.text   = UA_STRING((char*)name);
    h->displayName = dn;

    // The two target ids are namespace-zero constants shared by every node.
    // Safe where sharing the reference ARRAY is not: open62541 grows the array
    // with UA_realloc, but never writes through a target id.
    type_target->targetId       = UA_NodePointer_fromNodeId(&g_id_basedatavariabletype);
    type_target->targetNameHash = 0;
    organizes_target->targetId       = UA_NodePointer_fromNodeId(&g_id_objectsfolder);
    organizes_target->targetNameHash = 0;

    kinds[0].targets.array      = type_target;
    kinds[0].targetsSize        = 1;
    kinds[0].hasRefTree         = false;
    kinds[0].referenceTypeIndex = UA_REFERENCETYPEINDEX_HASTYPEDEFINITION;
    kinds[0].isInverse          = false;

    kinds[1].targets.array      = organizes_target;
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
    // Names point into flash, so nothing may free them: deleteNode in the
    // nodestore must never run over one of these.
    h->browseName.namespaceIndex = ns;
    h->browseName.name  = UA_STRING((char*)row->browse_name);
    // displayName is a singly-linked list of localised texts, not a scalar. One
    // entry, allocated with the references so release frees them together.
    h->displayName = nullptr;
    if (!build_refs(h, row->browse_name))
        return false;
    // Read-only attributes. The value is writable through the callback below
    // when permissions allow; everything else is fixed at compile time, and a
    // zero writeMask makes the server say so before it reaches the shared data.
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
    // Free in the shape build_refs() allocated: one block per kind. Freeing
    // only kinds[0] leaked the Organizes block whenever the SDK had grown it
    // into a new allocation -- and "the materialised copy is discarded anyway"
    // is a property of today's flash nodestore, not a contract to rely on.
    // The per-target NodeIds are shared statics and must not be freed.
    UA_NodeReferenceKind* kinds = node->head.references;
    for (size_t i = 0; i < 2; i++)
    {
        if (!kinds[i].hasRefTree && kinds[i].targets.array != nullptr)
            UA_free(kinds[i].targets.array);
    }
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

    // Swap the default nodestore for the flash-backed one now that the namespace
    // index is known. The nodestore was installed before the server existed, so
    // namespace zero is already built into the inner store and carried over
    // untouched; all that is left is naming our own namespace.
    extern UA_Nodestore* opcua_server_nodestore();
    UA_Nodestore* flash = opcua_server_nodestore();
    if (flash == nullptr)
        return UA_STATUSCODE_BADINTERNALERROR;
    UA_Nodestore_flashSetNamespace(flash, ns);

#if OPCUA_NODE_COUNT > 0
    // The nodes themselves are already in flash and need no adding, but the
    // Objects folder needs a forward reference to each or a Browse of Objects
    // will not find them. That is 8 B per node in the inner store, against the
    // 476 B the zip-tree charged to hold the node itself.
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
        // The matching inverse reference is already part of every flash node, so
        // the server trying to add it again is expected and harmless: the edit
        // lands on the materialised copy and is discarded on release.
        if (rc != UA_STATUSCODE_GOOD && rc != UA_STATUSCODE_BADDUPLICATEREFERENCENOTALLOWED)
        {
            OPCUA_LOG("[ns] addReference failed for node %u rc=0x%08lx",
                      (unsigned)row->node_id, (unsigned long)rc);
            return rc;
        }
    }
#endif
    {
        uint16_t ovUsed = 0; uint32_t ovRef = 0;
        UA_Arduino_getNs0OverlayStats(&ovUsed, &ovRef);
        OPCUA_LOG("[ns] ns0 overlay: used=%u refused=%lu", (unsigned)ovUsed, (unsigned long)ovRef);
    }
    return UA_STATUSCODE_GOOD;
}

#endif // OPCUA_ENABLED
