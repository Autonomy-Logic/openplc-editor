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

// Permission bitmap: two bits per role packed into one byte (viewer 0-1,
// operator 2-3, engineer 4-5). A byte rather than three enums because it is
// per-node flash data and the hot-path check is then a shift and a mask.
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

// `strucpp::debug::TypeTag` values that need naming on this side of the C
// boundary. Only the two string tags do: every other tag is handled positionally
// through `kTagToUaType[]`, but these two decide whether a value is a scalar or a
// {length, data} header, which is a branch and not a table lookup.
//
// Duplicated from the C++ `debug_table.hpp` rather than included, because this
// header is reached from plain-C translation units. `arduino_runtime_glue.cpp`
// sees both and static_asserts them equal, so the duplication cannot drift
// silently.
#define OPCUA_TAG_STRING   19
#define OPCUA_TAG_WSTRING  20

// One addressable leaf. `arr` / `elem` are the strucpp debug-table coordinates,
// so reading a node is `handle_read(arr, elem, dest)` against a table the
// compiler already emitted. `tag` is a `strucpp::debug::TypeTag`, duplicated
// here rather than including the C++ `debug_table.hpp`.
//
// Three places agree on that numbering and nothing but review keeps two of them
// honest: this header, `kTagToUaType[]` in opcua_nodes.cpp, and `TYPE_TAGS` in
// the editor's generate-opcua-header.ts. The firmware end is guarded -- an
// unknown tag is skipped, not misread -- and the generator refuses to emit a tag
// it has no mapping for, so a disagreement costs a build warning rather than a
// wrong value.
typedef struct
{
    uint16_t    node_id;      // numeric NodeId in the server's namespace
    const char* browse_name;  // flash-resident; also the display name
    uint8_t     tag;          // strucpp::debug::TypeTag
    uint8_t     arr;          // debug-table array index
    uint16_t    elem;         // debug-table element index
    uint8_t     perms;        // packed, see above
} opcua_node_t;

/** A username/password user. `password_hash` is the editor's
 *  `pbkdf2:sha256:<iters>$<salt>$<hash>` string, verified by a KDF chunked
 *  across scan cycles. */
typedef struct
{
    const char* username;
    const char* password_hash;
    uint8_t     role;
} opcua_user_t;

#endif // OPCUA_TYPES_H
