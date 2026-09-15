/*
opcua_types.h - shared contracts for the baremetal OPC-UA server
Copyright (C) 2026 Autonomy Logic

Pure declarations, no storage.  The generated `opcua_config.h` instantiates
`OPCUA_NODES[]` / `OPCUA_USERS[]` against the records declared here, so this
header and `generate-opcua-header.ts` are two halves of one ABI: change a
field on one side and the other must move with it.
*/

#ifndef OPCUA_TYPES_H
#define OPCUA_TYPES_H

#include <stdint.h>

// ---------------------------------------------------------------------------
// Permission bitmap.
//
// Two bits per role, packed into one byte: viewer 0-1, operator 2-3,
// engineer 4-5.  A byte rather than three enums because it is per-node data
// living in flash next to a few thousand siblings, and because the check on
// the hot path is then a shift and a mask.
// ---------------------------------------------------------------------------
#define OPCUA_PERM_READ   0x1u
#define OPCUA_PERM_WRITE  0x2u

#define OPCUA_ROLE_VIEWER   0
#define OPCUA_ROLE_OPERATOR 1
#define OPCUA_ROLE_ENGINEER 2

/** Role's 2-bit field out of a packed permission byte. */
static inline uint8_t opcua_perm_for_role(uint8_t packed, uint8_t role)
{
    return (uint8_t)((packed >> (role * 2)) & 0x3u);
}

static inline bool opcua_can_read(uint8_t packed, uint8_t role)
{
    return (opcua_perm_for_role(packed, role) & OPCUA_PERM_READ) != 0;
}

static inline bool opcua_can_write(uint8_t packed, uint8_t role)
{
    return (opcua_perm_for_role(packed, role) & OPCUA_PERM_WRITE) != 0;
}

// ---------------------------------------------------------------------------
// One addressable leaf.
//
// `arr` / `elem` are the strucpp debug-table coordinates, which is the whole
// reason this server is cheap to build: reading a node is
// `strucpp::debug::handle_read(arr, elem, dest)` against a table the compiler
// already emitted, so there is no shadow copy of the PLC state to keep in
// sync and no scan-rate mirroring loop.
//
// `tag` is a `strucpp::debug::TypeTag` value.  It is duplicated here rather
// than including `debug_table.hpp` because that header is C++ and pulls the
// generated program's type surface with it; the OPC-UA layer only needs the
// integer, and the generator asserts the same table.
// ---------------------------------------------------------------------------
typedef struct
{
    uint16_t    node_id;      // numeric NodeId in the server's namespace
    const char* browse_name;  // flash-resident; also the display name
    uint8_t     tag;          // strucpp::debug::TypeTag
    uint8_t     arr;          // debug-table array index
    uint16_t    elem;         // debug-table element index
    uint8_t     perms;        // packed, see above
} opcua_node_t;

/** A username/password user.  `password_hash` is the editor's
 *  `pbkdf2:sha256:<iters>$<salt>$<hash>` string, verified by a KDF that is
 *  chunked across scan cycles — at the iteration counts involved a
 *  single-shot verify would stall the PLC for seconds. */
typedef struct
{
    const char* username;
    const char* password_hash;
    uint8_t     role;
} opcua_user_t;

#endif // OPCUA_TYPES_H
