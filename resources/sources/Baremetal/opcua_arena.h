/*
opcua_arena.h - the bounded heap the OPC-UA server allocates from
Copyright (C) 2026 Autonomy Logic

open62541 allocates dynamically. On a PLC that is only acceptable if the
allocation can neither grow without limit nor disturb the allocator the user's
program is using, so every UA_malloc / UA_free is routed here instead of to
newlib.

Three properties this buys, all of which matter more on a PLC than the bytes do:

  - The footprint is a LINK-TIME fact. The arena is a static array sized by
    OPCUA_ARENA_SIZE from the VPP, so "too big" is an arduino-cli error in the
    same line the user already reads, not a device that stops answering in
    week three.
  - It cannot fragment the user program's heap. Those are separate pools; a
    long-running server churning session objects has no way to strand memory
    the IEC program will later ask for.
  - Exhaustion is observable. opcua_arena_stats() reports the high-water mark
    and the failed-allocation count, so "the arena is too small" is something
    the runtime can say rather than something inferred from a hang.
*/

#ifndef OPCUA_ARENA_H
#define OPCUA_ARENA_H

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Allocator entry points. Signatures match what open62541's UA_malloc /
 *  UA_free / UA_calloc / UA_realloc macros expand to, so wiring them is a
 *  compile definition rather than a shim layer. */
void* opcua_arena_malloc(size_t size);
void  opcua_arena_free(void* ptr);
void* opcua_arena_calloc(size_t count, size_t size);
void* opcua_arena_realloc(void* ptr, size_t size);

typedef struct
{
    uint32_t capacity;    // OPCUA_ARENA_SIZE
    uint32_t in_use;      // currently allocated payload + headers
    uint32_t high_water;  // largest in_use ever seen — the number to size against
    uint32_t failures;    // allocations refused for want of space
    uint32_t largest_free;// biggest single block available (fragmentation hint)
} opcua_arena_stats_t;

void opcua_arena_get_stats(opcua_arena_stats_t* out);

/** Reset to empty. Only safe with no server running; used by init. */
void opcua_arena_reset(void);

#ifdef __cplusplus
}
#endif

#endif // OPCUA_ENABLED
#endif // OPCUA_ARENA_H
