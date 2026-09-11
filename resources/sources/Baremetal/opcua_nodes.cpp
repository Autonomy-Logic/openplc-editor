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

UA_StatusCode opcua_nodes_populate(UA_Server* server, UA_UInt16* out_ns_index)
{
    UA_UInt16 ns = UA_Server_addNamespace(server, OPCUA_NAMESPACE_URI);
    if (out_ns_index != nullptr)
        *out_ns_index = ns;

#if OPCUA_NODE_COUNT > 0
    for (uint16_t i = 0; i < OPCUA_NODE_COUNT; i++)
    {
        const opcua_node_t* row = &OPCUA_NODES[i];
        if (row->tag >= kTagCount)
            continue;   // unexposable type; the generator should have dropped it

        UA_VariableAttributes attr = UA_VariableAttributes_default;
        attr.displayName = UA_LOCALIZEDTEXT((char*)"", (char*)row->browse_name);
        attr.dataType    = UA_TYPES[kTagToUaType[row->tag]].typeId;
        attr.valueRank   = UA_VALUERANK_SCALAR;
        attr.accessLevel = UA_ACCESSLEVELMASK_READ;
        if (any_role_may_write(row->perms))
            attr.accessLevel |= UA_ACCESSLEVELMASK_WRITE;

        UA_DataSource src;
        src.read  = read_node;
        src.write = write_node;

        // Numeric NodeId, string BrowseName: the numeric id keeps the node
        // cheap, the browse name is what a human sees in a client tree.
        const UA_StatusCode rc = UA_Server_addDataSourceVariableNode(
            server,
            UA_NODEID_NUMERIC(ns, row->node_id),
            UA_NODEID_NUMERIC(0, UA_NS0ID_OBJECTSFOLDER),
            UA_NODEID_NUMERIC(0, UA_NS0ID_ORGANIZES),
            UA_QUALIFIEDNAME(ns, (char*)row->browse_name),
            UA_NODEID_NUMERIC(0, UA_NS0ID_BASEDATAVARIABLETYPE),
            attr,
            src,
            // The row itself is the node context, so the callbacks need no
            // lookup. It lives in flash for the life of the image.
            (void*)row,
            nullptr);
        if (rc != UA_STATUSCODE_GOOD)
            return rc;   // an address space missing nodes is worse than none
    }
#endif
    return UA_STATUSCODE_GOOD;
}

#endif // OPCUA_ENABLED
