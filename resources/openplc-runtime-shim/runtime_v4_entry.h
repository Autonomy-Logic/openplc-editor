/*
 * runtime_v4_entry.h — C-linkage interface contract for STruC++-compiled .so
 *
 * The OpenPLC Runtime v4 dlopens a libplc_<hash>.so and dlsyms the symbols
 * declared in this header. The .so is built by compiling the user's
 * STruC++-generated C++ output together with a small static shim
 * (runtime_v4_entry.cpp) that exposes these symbols.
 *
 * This header is included by both the runtime's C code (which calls the
 * symbols) and the shim's C++ implementation (which defines them). It is
 * therefore a pure C header — no <iostream>, no namespaces, no templates.
 *
 * The struct layouts and enum values here MUST match what the STruC++
 * runtime headers expose in iec_located.hpp. Keep them in sync when the
 * STruC++ runtime ABI changes.
 */

#ifndef OPENPLC_STRUCPP_RUNTIME_V4_ENTRY_H
#define OPENPLC_STRUCPP_RUNTIME_V4_ENTRY_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C"
{
#endif

    /* -------------------------------------------------------------------- */
    /* Located-variable descriptor                                          */
    /*                                                                      */
    /* Mirrors strucpp::LocatedVar from iec_located.hpp. The .so populates  */
    /* the `pointer` field at construction time (each program's constructor */
    /* writes &member.value_ via raw_ptr()). The runtime walks this array   */
    /* and binds entries into its image-table buffers.                      */
    /* -------------------------------------------------------------------- */

    typedef enum {
        STRUCPP_AREA_INPUT  = 0,
        STRUCPP_AREA_OUTPUT = 1,
        STRUCPP_AREA_MEMORY = 2
    } strucpp_located_area_t;

    typedef enum {
        STRUCPP_SIZE_BIT   = 0,
        STRUCPP_SIZE_BYTE  = 1,
        STRUCPP_SIZE_WORD  = 2,
        STRUCPP_SIZE_DWORD = 3,
        STRUCPP_SIZE_LWORD = 4
    } strucpp_located_size_t;

    /* Layout MUST match strucpp::LocatedVar. Compile-time static_assert
     * lives in runtime_v4_entry.cpp. */
    typedef struct {
        uint8_t  area;        /* strucpp_located_area_t */
        uint8_t  size;        /* strucpp_located_size_t */
        uint16_t byte_index;
        uint8_t  bit_index;
        uint8_t  _reserved[3];
        void    *pointer;     /* IECVar<T>::raw_ptr() — points to value_ */
    } strucpp_located_var_t;

    /* -------------------------------------------------------------------- */
    /* Capability bits                                                      */
    /* -------------------------------------------------------------------- */
#define STRUCPP_CAP_PER_TASK   0x00000001u
#define STRUCPP_CAP_HIER_DEBUG 0x00000002u

    /* -------------------------------------------------------------------- */
    /* Lifecycle                                                            */
    /* -------------------------------------------------------------------- */
    typedef void (*strucpp_config_init_fn)(void);
    typedef void (*strucpp_update_time_fn)(void);

    /* -------------------------------------------------------------------- */
    /* Topology                                                             */
    /*                                                                      */
    /* Tasks are returned in priority-descending order: task_idx == 0 is    */
    /* always the highest-priority task. The runtime relies on this when    */
    /* placing the I/O coordinator and the watchdog anchor.                 */
    /* -------------------------------------------------------------------- */
    typedef size_t      (*strucpp_get_task_count_fn)(void);
    typedef const char *(*strucpp_get_task_name_fn)(size_t task_idx);
    typedef int64_t     (*strucpp_get_task_interval_ns_fn)(size_t task_idx);
    typedef int         (*strucpp_get_task_priority_fn)(size_t task_idx);
    typedef void        (*strucpp_run_task_fn)(size_t task_idx);

    /* -------------------------------------------------------------------- */
    /* I/O binding                                                          */
    /* -------------------------------------------------------------------- */
    typedef uint32_t                            (*strucpp_get_located_var_count_fn)(void);
    typedef const strucpp_located_var_t *       (*strucpp_get_located_vars_fn)(void);

    /* -------------------------------------------------------------------- */
    /* Hierarchical debug (defined by debug_dispatch.hpp's                  */
    /* STRUCPP_V4_DEBUG_EXPORTS_DEFINE block).                              */
    /* -------------------------------------------------------------------- */
    typedef uint8_t  (*strucpp_debug_array_count_fn)(void);
    typedef uint16_t (*strucpp_debug_elem_count_fn)(uint8_t arr);
    typedef uint16_t (*strucpp_debug_size_fn)(uint8_t arr, uint16_t elem);
    typedef uint8_t  (*strucpp_debug_set_fn)(uint8_t arr, uint16_t elem,
                                             bool forcing,
                                             const uint8_t *bytes, uint16_t len);
    typedef uint16_t (*strucpp_debug_read_fn)(uint8_t arr, uint16_t elem,
                                               uint8_t *dest);

    /* Optional addr accessor — returns the IECVar's underlying storage    */
    /* pointer (raw_ptr semantics). Plugins that need direct memory access  */
    /* use this; it's the migration target for the old `get_var_addr`      */
    /* flat-index API. Returns NULL on out-of-bounds.                      */
    typedef void *   (*strucpp_debug_get_addr_fn)(uint8_t arr, uint16_t elem);

#ifdef __cplusplus
} /* extern "C" */
#endif

#endif /* OPENPLC_STRUCPP_RUNTIME_V4_ENTRY_H */
