// runtime_v4_entry.cpp
//
// Static C-linkage entry points for the OpenPLC Runtime v4 .so.
//
// This file is hand-written and identical for every project. The CANONICAL
// copy lives in the openplc-runtime repo at
// `core/strucpp_runtime/runtime_v4_entry.cpp` — `scripts/compile.sh` in
// the runtime compiles it together with the user's uploaded
// generated.cpp/generated_debug.cpp into `libplc_<hash>.so`. The editor's
// upload bundle does NOT ship this file; the runtime owns it.
//
// This copy is editor-side reference material so the v4 ABI contract is
// readable from within the editor without checking out the runtime repo.
// It may drift from the runtime's canonical version between syncs — when
// the v4 ABI changes, copy the runtime's file over this one.

#define STRUCPP_V4_DEBUG_EXPORTS_DEFINE   // exposes strucpp_debug_* shims
#include "debug_dispatch.hpp"

#include "generated.hpp"
#include "iec_located.hpp"

#include <cstdint>
#include <cstddef>
#include <cstring>

using namespace strucpp;

// ---------------------------------------------------------------------------
// Configuration singleton.
// External linkage so generated_debug.cpp's compile-time address-of
// expressions resolve at link time. Same constraint as the Arduino
// sketch's g_config.
// ---------------------------------------------------------------------------
Configuration_CONFIG0 g_config;

// ---------------------------------------------------------------------------
// Topology cache.
//
// We flatten (resource, task) pairs into a single zero-based task_idx so
// the runtime doesn't need to know the resource layout. Tasks are sorted
// by priority descending so task 0 is always the highest-priority task —
// the runtime relies on this when assigning per-task heartbeats and
// choosing where to drive the I/O coordinator.
// ---------------------------------------------------------------------------
namespace {

struct TaskRef {
    TaskInstance* task;
    int32_t       priority;
};

constexpr size_t MAX_TASKS = 32;

TaskRef            g_tasks[MAX_TASKS];
size_t             g_task_count     = 0;
bool               g_topology_built = false;
unsigned long long g_gcd_ns         = 20000000ULL;

unsigned long long gcd_u64(unsigned long long a, unsigned long long b) {
    while (b) {
        unsigned long long t = b;
        b = a % b;
        a = t;
    }
    return a;
}

void build_topology() {
    if (g_topology_built) return;

    auto* resources = g_config.get_resources();
    for (size_t r = 0; r < g_config.get_resource_count(); ++r) {
        for (size_t t = 0; t < resources[r].task_count; ++t) {
            if (g_task_count >= MAX_TASKS) break;
            TaskInstance* tk = &resources[r].tasks[t];
            g_tasks[g_task_count].task     = tk;
            g_tasks[g_task_count].priority = tk->priority;
            ++g_task_count;

            unsigned long long ivl = tk->interval_ns > 0
                                         ? (unsigned long long)tk->interval_ns
                                         : 20000000ULL;
            g_gcd_ns = (g_gcd_ns == 20000000ULL && g_task_count == 1)
                           ? ivl
                           : gcd_u64(g_gcd_ns, ivl);
        }
    }

    // Insertion sort by priority descending.
    for (size_t i = 1; i < g_task_count; ++i) {
        TaskRef key = g_tasks[i];
        size_t  j   = i;
        while (j > 0 && g_tasks[j - 1].priority < key.priority) {
            g_tasks[j] = g_tasks[j - 1];
            --j;
        }
        g_tasks[j] = key;
    }

    g_topology_built = true;
}

} // namespace

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------
extern "C" unsigned long long common_ticktime__ = 20000000ULL;

#ifndef STRUCPP_PLC_PROGRAM_MD5
#define STRUCPP_PLC_PROGRAM_MD5 "00000000000000000000000000000000"
#endif
extern "C" const char *plc_program_md5 = STRUCPP_PLC_PROGRAM_MD5;

extern "C" void config_init__(void) {
    build_topology();
    common_ticktime__ = g_gcd_ns;
}

// updateTime() advances the strucpp runtime's scan-cycle clock by one
// base tick. CODESYS semantics: TIME() returns the same value for the
// duration of the cycle, so we increment between cycles.
extern "C" void updateTime(void) {
    strucpp::__CURRENT_TIME_NS += static_cast<int64_t>(g_gcd_ns);
}

// ---------------------------------------------------------------------------
// Topology
// ---------------------------------------------------------------------------
extern "C" size_t strucpp_get_task_count(void) {
    build_topology();
    return g_task_count;
}

extern "C" const char* strucpp_get_task_name(size_t task_idx) {
    build_topology();
    if (task_idx >= g_task_count) return "";
    return g_tasks[task_idx].task->name;
}

extern "C" int64_t strucpp_get_task_interval_ns(size_t task_idx) {
    build_topology();
    if (task_idx >= g_task_count) return 0;
    return g_tasks[task_idx].task->interval_ns;
}

extern "C" int strucpp_get_task_priority(size_t task_idx) {
    build_topology();
    if (task_idx >= g_task_count) return 0;
    return g_tasks[task_idx].priority;
}

extern "C" void strucpp_run_task(size_t task_idx) {
    if (task_idx >= g_task_count) return;
    TaskInstance* task = g_tasks[task_idx].task;
    for (size_t p = 0; p < task->program_count; ++p) {
        task->programs[p]->run();
    }
}

// ---------------------------------------------------------------------------
// I/O binding — the runtime walks this descriptor table itself.
// ---------------------------------------------------------------------------
extern "C" uint32_t strucpp_get_located_var_count(void) {
    return locatedVarsCount;
}

extern "C" const LocatedVar* strucpp_get_located_vars(void) {
    return locatedVars;
}

// ---------------------------------------------------------------------------
// Optional debug address accessor — returns the IECVar's underlying
// storage pointer for plugins that need direct memory access.
// ---------------------------------------------------------------------------
extern "C" void* strucpp_debug_get_addr(uint8_t arr, uint16_t elem) {
    auto e = strucpp::debug::read_entry(arr, elem);
    return e.ptr;
}

// ---------------------------------------------------------------------------
// Capabilities
//   bit 0 — supports per-task threading (strucpp_run_task)
//   bit 1 — supports hierarchical debug (strucpp_debug_*)
// ---------------------------------------------------------------------------
extern "C" const uint32_t strucpp_capabilities = 0x00000003u;
