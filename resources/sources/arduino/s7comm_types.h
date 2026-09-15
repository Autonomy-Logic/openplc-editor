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

// Area codes, as they travel on the wire. Duplicated from the S7 library rather
// than included from it, because this header is part of the contract with the
// code generator, which has no business including an Arduino library.
#define S7COMM_AREA_PE   0x81u  // Process inputs  (I)
#define S7COMM_AREA_PA   0x82u  // Process outputs (Q)
#define S7COMM_AREA_MK   0x83u  // Merkers         (M)
#define S7COMM_AREA_DB   0x84u  // Data blocks     (DB)

// Which OpenPLC located-variable buffer an area is cut from. Runtime v4's model,
// so a project moved between targets addresses the same variable the same way.
// Not every buffer exists on every target -- `bool_memory` and the `byte_*`
// buffers are v3/v4 only -- so the generator refuses them at build time.
#define S7COMM_BUF_BOOL_INPUT    0u  // %IX -> bool_input[byte][bit]
#define S7COMM_BUF_BOOL_OUTPUT   1u  // %QX -> bool_output[byte][bit]
#define S7COMM_BUF_INT_INPUT     2u  // %IW -> int_input[]
#define S7COMM_BUF_INT_OUTPUT    3u  // %QW -> int_output[]
#define S7COMM_BUF_INT_MEMORY    4u  // %MW -> int_memory[]
#define S7COMM_BUF_DINT_MEMORY   5u  // %MD -> dint_memory[]
#define S7COMM_BUF_LINT_MEMORY   6u  // %ML -> lint_memory[]

// One addressable region. An S7 area is a flat run of bytes: no address space,
// no node ids, no browse names, no per-node permissions. The table is emitted
// `const` and lives in flash, fixed when the project is built.
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
 *  Bit buffers contribute one byte per eight slots, which is why bit areas are
 *  addressed as `byte.bit` and why this returns 0 for them: callers must use the
 *  bit path rather than multiplying. Anything else is a straight width.
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
