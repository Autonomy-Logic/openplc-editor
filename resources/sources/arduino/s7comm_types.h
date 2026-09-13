/*
s7comm_types.h - shared contracts for the baremetal S7Comm server
Copyright (C) 2026 Autonomy Logic

Pure declarations, no storage.  The generated `s7comm_config.h` instantiates
`S7COMM_AREAS[]` against the record declared here, so this header and
`generate-s7comm-header.ts` are two halves of one ABI: change a field on one
side and the other must move with it.
*/

#ifndef S7COMM_TYPES_H
#define S7COMM_TYPES_H

#include <stdint.h>

// ---------------------------------------------------------------------------
// Area codes, as they travel on the wire.
//
// Duplicated from the S7 library rather than included from it, for the reason
// opcua_types.h duplicates strucpp's TypeTag: this header is part of the
// contract with the CODE GENERATOR, which has no business including an Arduino
// library. They are protocol constants -- there is exactly one correct value
// for each, and it has not changed since the S7-300.
// ---------------------------------------------------------------------------
#define S7COMM_AREA_PE   0x81u  // Process inputs  (I)
#define S7COMM_AREA_PA   0x82u  // Process outputs (Q)
#define S7COMM_AREA_MK   0x83u  // Merkers         (M)
#define S7COMM_AREA_DB   0x84u  // Data blocks     (DB)

// ---------------------------------------------------------------------------
// Which OpenPLC located-variable buffer an area is cut from.
//
// THIS IS RUNTIME v4'S MODEL, deliberately. The editor's S7 configuration
// screen already asks "which buffer, starting at which index", the v4 plugin
// already consumes exactly that, and parity means a project moved between
// targets addresses the same variable the same way. Inventing a second mapping
// for baremetal would be a second thing to be wrong.
//
// It is also simpler than what OPC-UA needed here. OPC-UA publishes NAMED
// variables and so had to resolve paths through debug-map.json; an S7 area is
// a flat run of bytes over a buffer that already exists, so the whole address
// space is (buffer, start index, length).
//
// Not every buffer exists on every target. `bool_memory` and the `byte_*`
// buffers are Runtime v3/v4 only -- openplc.h has no such arrays on an
// arduino-cli build -- so the generator refuses them at BUILD time with a
// message naming the data block, rather than emitting an area the runtime
// would have to fail on in the field.
// ---------------------------------------------------------------------------
#define S7COMM_BUF_BOOL_INPUT    0u  // %IX -> bool_input[byte][bit]
#define S7COMM_BUF_BOOL_OUTPUT   1u  // %QX -> bool_output[byte][bit]
#define S7COMM_BUF_INT_INPUT     2u  // %IW -> int_input[]
#define S7COMM_BUF_INT_OUTPUT    3u  // %QW -> int_output[]
#define S7COMM_BUF_INT_MEMORY    4u  // %MW -> int_memory[]
#define S7COMM_BUF_DINT_MEMORY   5u  // %MD -> dint_memory[]
#define S7COMM_BUF_LINT_MEMORY   6u  // %ML -> lint_memory[]

// ---------------------------------------------------------------------------
// One addressable region.
//
// An S7 area is a FLAT RUN OF BYTES, which is why this protocol is an order of
// magnitude cheaper on a microcontroller than OPC-UA: there is no address
// space to build, no node ids, no browse names, no per-node permissions. A
// request names (area, db, offset, length) and the server answers with bytes.
//
// The table is emitted `const` and lives in flash. It is fixed when the
// project is built and never changes, so there is no version of this that
// should cost RAM -- the same argument that forced the OPC-UA flash nodestore,
// except here it costs nothing to get right because there is no UA_Node
// equivalent to materialise.
// ---------------------------------------------------------------------------
typedef struct
{
    uint8_t  area;         // S7COMM_AREA_*
    uint16_t db_number;    // meaningful only for S7COMM_AREA_DB; 0 otherwise
    uint16_t size_bytes;   // the bound every request is checked against
    uint8_t  buffer;       // S7COMM_BUF_*
    uint16_t start_index;  // first slot of that buffer the area covers
    uint8_t  writable;     // 0 = reads only, whatever the server-wide setting
} s7comm_area_t;

/** Bytes one slot of a buffer contributes to an S7 area.
 *
 *  Bit buffers contribute one byte per EIGHT slots, which is why bit areas are
 *  addressed as `byte.bit` and why this returns 0 for them -- callers must use
 *  the bit path rather than multiplying. Anything else is a straight width.
 */
static inline uint8_t s7comm_slot_bytes(uint8_t buffer)
{
    switch (buffer)
    {
        case S7COMM_BUF_BOOL_INPUT:
        case S7COMM_BUF_BOOL_OUTPUT:  return 0;   // see the note above
        case S7COMM_BUF_INT_INPUT:
        case S7COMM_BUF_INT_OUTPUT:
        case S7COMM_BUF_INT_MEMORY:   return 2;
        case S7COMM_BUF_DINT_MEMORY:  return 4;
        case S7COMM_BUF_LINT_MEMORY:  return 8;
        default:                      return 0;
    }
}

/** True when the buffer is addressed a bit at a time. */
static inline bool s7comm_is_bit_buffer(uint8_t buffer)
{
    return buffer == S7COMM_BUF_BOOL_INPUT || buffer == S7COMM_BUF_BOOL_OUTPUT;
}

#endif // S7COMM_TYPES_H
