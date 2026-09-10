/*
opcua_arena.cpp - first-fit free-list allocator over a fixed static arena
Copyright (C) 2026 Autonomy Logic

Deliberately a boring allocator. It is not trying to be fast: the OPC-UA
server allocates on session setup and per-request scratch, at human timescales,
not in the scan-critical path. What it is trying to be is BOUNDED and
OBSERVABLE, which newlib's malloc on a shared heap is neither.

Layout: one arena, carved into blocks. Every block carries a 4-byte header
holding its size and a free flag; free neighbours are coalesced on release so
a long-running server does not saw the arena into unusable slivers.
*/

#include "opcua_arena.h"

#if OPCUA_ENABLED

#include <string.h>

namespace {

// 8-byte alignment: the strictest thing open62541 stores in allocated memory
// on this ABI is a double / UA_DateTime (8 bytes). Aligning everything to 8
// avoids having to reason per-type about it.
constexpr size_t kAlign = 8;

struct BlockHeader
{
    uint32_t size;  // payload bytes, excluding this header
    uint32_t free;  // 1 = available. A whole word rather than a bit so the
                    // payload stays 8-byte aligned without extra padding.
};

constexpr size_t kHeader = sizeof(BlockHeader);   // 8 bytes, keeps payloads aligned

inline size_t align_up(size_t n) { return (n + (kAlign - 1)) & ~(kAlign - 1); }

/** The arena.
 *
 *  `__attribute__((used))` plus the reference from opcua_arena_reset() (which
 *  the server's init calls) is what keeps this in .bss: the core links with
 *  --gc-sections, and an array nothing demonstrably reads gets discarded —
 *  measured, silently, all 32 KB of it. A dropped arena would let an
 *  over-budget build link cleanly and fail only on the device, which is the
 *  exact failure this arena exists to prevent. */
__attribute__((used)) alignas(kAlign) uint8_t g_arena[OPCUA_ARENA_SIZE];

bool     g_ready      = false;
uint32_t g_in_use     = 0;
uint32_t g_high_water = 0;
uint32_t g_failures   = 0;

inline BlockHeader* first_block() { return reinterpret_cast<BlockHeader*>(g_arena); }

inline BlockHeader* next_block(BlockHeader* b)
{
    uint8_t* p = reinterpret_cast<uint8_t*>(b) + kHeader + b->size;
    if (p >= g_arena + OPCUA_ARENA_SIZE)
        return nullptr;
    return reinterpret_cast<BlockHeader*>(p);
}

void init_if_needed()
{
    if (g_ready)
        return;
    BlockHeader* b = first_block();
    b->size = OPCUA_ARENA_SIZE - kHeader;
    b->free = 1;
    g_in_use = 0;
    g_ready = true;
}

/** Merge a block with every free block that follows it. Called on free, so
 *  the arena tends back toward one large block rather than accumulating
 *  fragments across sessions. */
void coalesce_forward(BlockHeader* b)
{
    for (;;)
    {
        BlockHeader* n = next_block(b);
        if (n == nullptr || !n->free)
            return;
        b->size += kHeader + n->size;
    }
}

/** Split a block if the remainder can hold a header plus useful payload.
 *  Without the kAlign floor this would carve off zero-byte blocks that can
 *  never be allocated but still cost a header to walk past. */
void split_if_worthwhile(BlockHeader* b, size_t want)
{
    if (b->size < want + kHeader + kAlign)
        return;
    BlockHeader* rest = reinterpret_cast<BlockHeader*>(
        reinterpret_cast<uint8_t*>(b) + kHeader + want);
    rest->size = static_cast<uint32_t>(b->size - want - kHeader);
    rest->free = 1;
    b->size = static_cast<uint32_t>(want);
}

} // namespace

void opcua_arena_reset(void)
{
    g_ready = false;
    g_high_water = 0;
    g_failures = 0;
    init_if_needed();
}

void* opcua_arena_malloc(size_t size)
{
    if (size == 0)
        return nullptr;
    init_if_needed();

    const size_t want = align_up(size);

    // First fit, not best fit. Best fit costs a full walk on every allocation
    // to buy less fragmentation than forward coalescing already provides for
    // this workload (a handful of long-lived session objects plus short-lived
    // request scratch).
    for (BlockHeader* b = first_block(); b != nullptr; b = next_block(b))
    {
        if (!b->free || b->size < want)
            continue;
        split_if_worthwhile(b, want);
        b->free = 0;
        g_in_use += kHeader + b->size;
        if (g_in_use > g_high_water)
            g_high_water = g_in_use;
        return reinterpret_cast<uint8_t*>(b) + kHeader;
    }

    // Counted, not silent. An arena that is too small should be a reportable
    // number, not a mysterious refusal to accept connections.
    g_failures++;
    return nullptr;
}

void opcua_arena_free(void* ptr)
{
    if (ptr == nullptr)
        return;
    // Ignore anything that is not ours. open62541 should never hand us a
    // foreign pointer, but a bounds check is cheaper than the corruption it
    // would otherwise cause, and this runs off the scan-critical path.
    uint8_t* p = static_cast<uint8_t*>(ptr);
    if (p < g_arena + kHeader || p >= g_arena + OPCUA_ARENA_SIZE)
        return;

    BlockHeader* b = reinterpret_cast<BlockHeader*>(p - kHeader);
    if (b->free)
        return; // double free — leave the arena consistent rather than corrupt it
    b->free = 1;
    const uint32_t released = kHeader + b->size;
    g_in_use = (g_in_use >= released) ? g_in_use - released : 0;
    coalesce_forward(b);
}

void* opcua_arena_calloc(size_t count, size_t size)
{
    // Overflow check before multiplying: a wrapped product would allocate a
    // small block and then be memset as if it were huge.
    if (count != 0 && size > (SIZE_MAX / count))
        return nullptr;
    const size_t total = count * size;
    void* p = opcua_arena_malloc(total);
    if (p != nullptr)
        memset(p, 0, total);
    return p;
}

void* opcua_arena_realloc(void* ptr, size_t size)
{
    if (ptr == nullptr)
        return opcua_arena_malloc(size);
    if (size == 0)
    {
        opcua_arena_free(ptr);
        return nullptr;
    }

    BlockHeader* b = reinterpret_cast<BlockHeader*>(static_cast<uint8_t*>(ptr) - kHeader);
    const size_t old_size = b->size;
    if (align_up(size) <= old_size)
        return ptr; // shrink in place; the tail stays with the block

    void* fresh = opcua_arena_malloc(size);
    if (fresh == nullptr)
        return nullptr; // caller keeps the original, per realloc semantics
    memcpy(fresh, ptr, old_size < size ? old_size : size);
    opcua_arena_free(ptr);
    return fresh;
}

void opcua_arena_get_stats(opcua_arena_stats_t* out)
{
    if (out == nullptr)
        return;
    init_if_needed();
    uint32_t largest = 0;
    for (BlockHeader* b = first_block(); b != nullptr; b = next_block(b))
    {
        if (b->free && b->size > largest)
            largest = b->size;
    }
    out->capacity     = OPCUA_ARENA_SIZE;
    out->in_use       = g_in_use;
    out->high_water   = g_high_water;
    out->failures     = g_failures;
    out->largest_free = largest;
}

#endif // OPCUA_ENABLED
