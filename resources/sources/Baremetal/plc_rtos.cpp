// plc_rtos.cpp — RTOS mode's tasks. See plc_rtos.h for the model.
//
// Everything below is inside `#if OPENPLC_RTOS`; a build that is not in RTOS
// mode compiles this file to nothing.

#include "rtos_config.h"

#if OPENPLC_RTOS

#include "ModbusSlave.h"
#include "arduino_runtime_glue.h"
#include "plc_os.h"
#include "plc_rtos.h"

extern "C" {
#include "openplc.h"
}

#if !defined(OPLC_NET_LOCKED) || !defined(OPLC_NET_ON_SPI)
#error "modbus_config.h decides whether the network needs a lock in RTOS mode, and did not"
#endif

#ifndef OPENPLC_RTOS_RETAIN_PERIOD_US
// How often retained values are handed to the platform. Not every frame: at a
// fast base tick that is pure overhead, and the platform decides for itself
// when to commit.
#define OPENPLC_RTOS_RETAIN_PERIOD_US 20000
#endif

#ifndef OPENPLC_RTOS_START_WAIT_US
// The longest the first scan waits for the network to come up (service A's
// start-up). The Modbus TCP start-up itself gives Wi-Fi 5 s.
#define OPENPLC_RTOS_START_WAIT_US 15000000
#endif

// A task waiting for a start-up signal also looks at the flag this often: a
// signal sent before its task handle was stored is otherwise lost.
#define RTOS_SIGNAL_POLL_US 10000

// The worker tables are sized to the build: the editor writes its number of
// workers into rtos_config.h (plc_os.h has the fallback).
#define RTOS_MAX_WORKERS OPENPLC_RTOS_MAX_WORKERS

// ---------------------------------------------------------------------------
// Tasks and the release handshake
// ---------------------------------------------------------------------------

static plc_rtos_config_t s_config;

static plc_os_task_t s_dispatcher = nullptr;
static plc_os_task_t s_service_a  = nullptr;
static plc_os_task_t s_service_b  = nullptr;

// One per IEC task worker (see runtime_rtos_prepare_workers()).
struct Worker {
    plc_os_task_t task;
    uint32_t      divisor;        // released every this many base ticks
    // Releases handed over and finished. Equal means idle; the dispatcher never
    // releases a worker while they differ, so an overrunning task is skipped,
    // never queued.
    uint32_t      released;
    uint32_t      completed;
    uint64_t      next_tick;      // the grid point it is next due at, in base ticks
    uint64_t      release_tick;   // grid time of the release, in base ticks
    int64_t       release_us;     // written by the dispatcher before the release
    int64_t       start_us;       // written by the worker before it signals completion
    int64_t       end_us;
    bool          recorded;       // this release's timing is in the statistics
};

static Worker   s_workers[RTOS_MAX_WORKERS];
static uint32_t s_worker_count = 0;
// The worker the optional Arduino sketch runs in (see plc_rtos_config_t).
static uint32_t s_sketch_worker = 0;

static bool worker_idle(uint32_t w)
{
    return __atomic_load_n(&s_workers[w].completed, __ATOMIC_ACQUIRE) == s_workers[w].released;
}

static bool all_idle(void)
{
    for (uint32_t w = 0; w < s_worker_count; ++w)
        if (!worker_idle(w)) return false;
    return true;
}

static bool faulted(void) { return runtime_rtos_state() == PLC_STATE_ERROR; }

// ---------------------------------------------------------------------------
// The network, bus and serial port locks (plc_rtos.h)
//
// All exist in RTOS mode: a library object shared between tasks (an MQTT
// client) needs its lock whatever the stack. Whether the services take the
// network lock is OPLC_NET_LOCKED's call (modbus_config.h).
// ---------------------------------------------------------------------------

static plc_os_mutex_t s_net_lock = nullptr;
static plc_os_mutex_t s_i2c_lock = nullptr;
static plc_os_mutex_t s_spi_lock = nullptr;
static plc_os_mutex_t s_can_lock = nullptr;

// A lock per serial port, keyed by the port object, so any kind of port has
// one. A port takes the next free lock the first time it is locked; ports past
// the last share it. On a small board the one bus lock serves them all.
#if !defined(PLC_OS_SMALL_STACKS)
#ifndef OPENPLC_RTOS_SERIAL_LOCKS
#define OPENPLC_RTOS_SERIAL_LOCKS 8
#endif
static plc_os_mutex_t s_serial_locks[OPENPLC_RTOS_SERIAL_LOCKS];
static const void *s_serial_ports[OPENPLC_RTOS_SERIAL_LOCKS];
static plc_os_mutex_t s_serial_table_lock = nullptr;
#endif

static void make_bus_locks(void)
{
    s_net_lock = plc_os_rmutex_create();
#if defined(PLC_OS_SMALL_STACKS)
    // A few kilobytes of RTOS heap: one lock serves every bus. Nothing else is
    // taken under any of them, so sharing one cannot deadlock; one bus may only
    // wait for another.
    s_i2c_lock = s_net_lock;
    s_spi_lock = s_net_lock;
    s_can_lock = s_net_lock;
#else
    s_i2c_lock = plc_os_rmutex_create();
#if OPLC_NET_ON_SPI
    s_spi_lock = s_net_lock;
#else
    s_spi_lock = plc_os_rmutex_create();
#endif
    s_can_lock = plc_os_rmutex_create();
    s_serial_table_lock = plc_os_rmutex_create();
    if (!s_serial_table_lock) runtime_rtos_fault();
    for (uint32_t i = 0; i < OPENPLC_RTOS_SERIAL_LOCKS; ++i) {
        s_serial_locks[i] = plc_os_rmutex_create();
        if (!s_serial_locks[i]) runtime_rtos_fault();
    }
#endif
    if (!s_net_lock || !s_i2c_lock || !s_spi_lock || !s_can_lock) runtime_rtos_fault();
}

static plc_os_mutex_t serial_lock_of(const void *port)
{
#if defined(PLC_OS_SMALL_STACKS)
    (void)port;
    return s_net_lock;
#else
    if (!port || !s_serial_table_lock) return nullptr;
    plc_os_rmutex_lock(s_serial_table_lock);
    uint32_t i = 0;
    while (i < OPENPLC_RTOS_SERIAL_LOCKS - 1 && s_serial_ports[i] && s_serial_ports[i] != port) ++i;
    if (!s_serial_ports[i]) s_serial_ports[i] = port;
    plc_os_rmutex_unlock(s_serial_table_lock);
    return s_serial_locks[i];
#endif
}

extern "C" void openplc_net_lock(void) { plc_os_rmutex_lock(s_net_lock); }
extern "C" void openplc_net_unlock(void) { plc_os_rmutex_unlock(s_net_lock); }
extern "C" void openplc_i2c_lock(void) { plc_os_rmutex_lock(s_i2c_lock); }
extern "C" void openplc_i2c_unlock(void) { plc_os_rmutex_unlock(s_i2c_lock); }
extern "C" void openplc_spi_lock(void) { plc_os_rmutex_lock(s_spi_lock); }
extern "C" void openplc_spi_unlock(void) { plc_os_rmutex_unlock(s_spi_lock); }
extern "C" void openplc_can_lock(void) { plc_os_rmutex_lock(s_can_lock); }
extern "C" void openplc_can_unlock(void) { plc_os_rmutex_unlock(s_can_lock); }
extern "C" void openplc_serial_lock(void *port) { plc_os_rmutex_lock(serial_lock_of(port)); }
extern "C" void openplc_serial_unlock(void *port) { plc_os_rmutex_unlock(serial_lock_of(port)); }

// The services' side: only where the stack needs it.
void plc_rtos_service_net_lock(void)
{
#if OPLC_NET_LOCKED
    plc_os_rmutex_lock(s_net_lock);
#endif
}

void plc_rtos_service_net_unlock(void)
{
#if OPLC_NET_LOCKED
    plc_os_rmutex_unlock(s_net_lock);
#endif
}

bool plc_rtos_service_net_try_lock(void)
{
#if OPLC_NET_LOCKED
    return plc_os_rmutex_lock_for(s_net_lock, 0);
#else
    return true;
#endif
}

// ---------------------------------------------------------------------------
// Statistics
//
// Accumulated by the dispatcher alone and published as a snapshot under a lock
// it only tries, so a reader never delays a frame. Service A samples the stacks
// and heap: a high-water-mark scan at the dispatcher's priority would be jitter
// on every task.
// ---------------------------------------------------------------------------

struct TaskWindow {
    uint32_t releases;
    uint32_t overruns;
    uint32_t scan_min_us, scan_max_us;
    uint64_t scan_total_us;
    uint32_t latency_max_us;
    uint64_t latency_total_us;
    uint32_t cycle_min_us, cycle_max_us;
    uint32_t samples;
    int64_t  prev_start_us;
};

struct StatsSnapshot {
    TaskWindow work[RTOS_MAX_WORKERS];
    uint32_t   work_stack_free[RTOS_MAX_WORKERS];
    uint32_t   dispatcher_stack_free;
    uint32_t   service_iter_max_us[2];
    uint32_t   service_busy[2];
    uint32_t   service_stack_free[2];
    uint32_t   heap_free, heap_min_free;
    uint32_t   retain_late_max_us;
};

static TaskWindow     s_window[RTOS_MAX_WORKERS];   // the dispatcher's own
static uint32_t       s_retain_late_max_us = 0;     // the dispatcher's own
static StatsSnapshot  s_published;                  // what FC 0x4E reads
static plc_os_mutex_t s_stats_lock = nullptr;
static bool           s_reset_requested = false;

// Written by service A's sampling, read by the dispatcher.
static uint32_t s_work_stack_free[RTOS_MAX_WORKERS];
static uint32_t s_stack_free[3];                    // dispatcher, A, B
static uint32_t s_heap_free = 0, s_heap_min_free = 0;
static int64_t  s_next_health_sample_us = 0;

// Written only by the service that owns the slot.
static uint32_t s_service_iter_max_us[2];
static uint32_t s_service_busy[2];

static void window_reset(TaskWindow &w)
{
    w = TaskWindow{};
    w.scan_min_us  = UINT32_MAX;
    w.cycle_min_us = UINT32_MAX;
}

static void record_scan(uint32_t i)
{
    Worker &k = s_workers[i];
    if (k.recorded) return;
    k.recorded = true;
    const uint32_t scan    = (uint32_t)(k.end_us - k.start_us);
    const uint32_t latency = (uint32_t)(k.start_us - k.release_us);
    TaskWindow &w = s_window[i];
    w.samples++;
    if (scan < w.scan_min_us) w.scan_min_us = scan;
    if (scan > w.scan_max_us) w.scan_max_us = scan;
    w.scan_total_us += scan;
    if (latency > w.latency_max_us) w.latency_max_us = latency;
    w.latency_total_us += latency;
    if (w.prev_start_us != 0) {
        const uint32_t cycle = (uint32_t)(k.start_us - w.prev_start_us);
        if (cycle < w.cycle_min_us) w.cycle_min_us = cycle;
        if (cycle > w.cycle_max_us) w.cycle_max_us = cycle;
    }
    w.prev_start_us = k.start_us;
}

// Service A, once a second: stack margins and the heap.
static void sample_health(void)
{
    const int64_t now = plc_os_now_us();
    if (now < s_next_health_sample_us) return;
    s_next_health_sample_us = now + 1000000;
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        const uint32_t free_bytes = s_workers[w].task ? plc_os_task_stack_free_bytes(s_workers[w].task) : 0;
        __atomic_store_n(&s_work_stack_free[w], free_bytes, __ATOMIC_RELAXED);
    }
    __atomic_store_n(&s_stack_free[0], s_dispatcher ? plc_os_task_stack_free_bytes(s_dispatcher) : 0, __ATOMIC_RELAXED);
    __atomic_store_n(&s_stack_free[1], plc_os_task_stack_free_bytes(nullptr), __ATOMIC_RELAXED);
    __atomic_store_n(&s_stack_free[2], s_service_b ? plc_os_task_stack_free_bytes(s_service_b) : 0, __ATOMIC_RELAXED);
    __atomic_store_n(&s_heap_free, plc_os_heap_free(), __ATOMIC_RELAXED);
    __atomic_store_n(&s_heap_min_free, plc_os_heap_min_free(), __ATOMIC_RELAXED);
}

static void publish_stats(void)
{
    if (!plc_os_mutex_lock_for(s_stats_lock, 0)) return;   // a reader has it: next frame
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        s_published.work[w]            = s_window[w];
        s_published.work_stack_free[w] = __atomic_load_n(&s_work_stack_free[w], __ATOMIC_RELAXED);
    }
    for (int i = 0; i < 2; ++i) {
        s_published.service_iter_max_us[i] = __atomic_load_n(&s_service_iter_max_us[i], __ATOMIC_RELAXED);
        s_published.service_busy[i]        = __atomic_load_n(&s_service_busy[i], __ATOMIC_RELAXED);
        s_published.service_stack_free[i]  = __atomic_load_n(&s_stack_free[1 + i], __ATOMIC_RELAXED);
    }
    s_published.dispatcher_stack_free = __atomic_load_n(&s_stack_free[0], __ATOMIC_RELAXED);
    s_published.heap_free             = __atomic_load_n(&s_heap_free, __ATOMIC_RELAXED);
    s_published.heap_min_free         = __atomic_load_n(&s_heap_min_free, __ATOMIC_RELAXED);
    s_published.retain_late_max_us    = s_retain_late_max_us;
    const bool reset = s_reset_requested;
    s_reset_requested = false;
    plc_os_mutex_unlock(s_stats_lock);

    if (reset) {
        for (uint32_t w = 0; w < s_worker_count; ++w) window_reset(s_window[w]);
        for (int i = 0; i < 2; ++i) __atomic_store_n(&s_service_iter_max_us[i], 0, __ATOMIC_RELAXED);
        s_retain_late_max_us = 0;
    }
}

static void put_u32(uint8_t *&p, uint32_t v)
{
    *p++ = (uint8_t)(v >> 24);
    *p++ = (uint8_t)(v >> 16);
    *p++ = (uint8_t)(v >> 8);
    *p++ = (uint8_t)v;
}

// Version 2 layout, all big-endian:
//   [version:u8=2][task_total:u8][first:u8][task_count:u8]
//   per task, from `first`: [name_len:u8][name], then releases, overruns,
//             scan_min_us, scan_avg_us, scan_max_us, latency_avg_us,
//             latency_max_us, cycle_min_us, cycle_max_us, stack_free_bytes,
//             busy_us, period_us                               (12 x u32)
//   [service_count:u8=2]
//   per service: iteration_max_us, busy_replies, stack_free_bytes (3 x u32)
//   dispatcher_stack_free, heap_free, heap_min_free, base_tick_us,
//   retain_late_max_us                                         (5 x u32)
// As many tasks as fit the frame; a reader asks again from first + task_count
// until it has task_total. busy_us is live (time in the current scan, 0 between
// scans) and period_us the task's interval, so a reader can tell a stuck task;
// the rest is the published snapshot. Counters wrap at 2^32.
#define RTOS_STATS_TASK_BYTES 48u
#define RTOS_STATS_FIXED_BYTES (4u + 1u + 2u * 12u + 20u)

size_t plc_rtos_encode_stats(uint8_t *out, size_t capacity, uint8_t first, bool reset)
{
    if (capacity < RTOS_STATS_FIXED_BYTES) return 0;

    static StatsSnapshot snap;   // too big for a service task's stack
    plc_os_mutex_lock(s_stats_lock);
    snap = s_published;
    plc_os_mutex_unlock(s_stats_lock);

    uint8_t *p = out;
    *p++ = 2;                                   // version
    *p++ = (uint8_t)s_worker_count;             // task_total
    *p++ = first;
    uint8_t *task_count = p++;
    *task_count = 0;
    size_t room = capacity - RTOS_STATS_FIXED_BYTES;
    for (uint32_t i = first; i < s_worker_count; ++i) {
        const char *name = runtime_rtos_worker_name(i);
        size_t len = 0;
        while (name && name[len] && len < 16) ++len;
        if (room < 1 + len + RTOS_STATS_TASK_BYTES) break;
        room -= 1 + len + RTOS_STATS_TASK_BYTES;
        *p++ = (uint8_t)len;
        for (size_t c = 0; c < len; ++c) *p++ = (uint8_t)name[c];
        const TaskWindow &w = snap.work[i];
        const uint32_t n = w.samples ? w.samples : 1;
        put_u32(p, w.releases);
        put_u32(p, w.overruns);
        put_u32(p, w.samples ? w.scan_min_us : 0);
        put_u32(p, (uint32_t)(w.scan_total_us / n));
        put_u32(p, w.scan_max_us);
        put_u32(p, (uint32_t)(w.latency_total_us / n));
        put_u32(p, w.latency_max_us);
        put_u32(p, w.cycle_min_us == UINT32_MAX ? 0 : w.cycle_min_us);
        put_u32(p, w.cycle_max_us);
        put_u32(p, snap.work_stack_free[i]);
        put_u32(p, runtime_rtos_worker_busy_us(i));
        put_u32(p, (uint32_t)((base_tick_ns / 1000ULL) * runtime_rtos_worker_divisor(i)));
        (*task_count)++;
    }
    *p++ = 2;   // services: A (Modbus, debugger, discovery), B (OPC-UA, S7)
    for (int i = 0; i < 2; ++i) {
        put_u32(p, snap.service_iter_max_us[i]);
        put_u32(p, snap.service_busy[i]);
        put_u32(p, snap.service_stack_free[i]);
    }
    put_u32(p, snap.dispatcher_stack_free);
    put_u32(p, snap.heap_free);
    put_u32(p, snap.heap_min_free);
    put_u32(p, (uint32_t)(base_tick_ns / 1000ULL));
    put_u32(p, snap.retain_late_max_us);

    // The window restarts once the reader has the last task, so every page of
    // one reading comes from the same window.
    if (reset && (uint32_t)first + *task_count >= s_worker_count) {
        plc_os_mutex_lock(s_stats_lock);
        s_reset_requested = true;
        plc_os_mutex_unlock(s_stats_lock);
    }
    return (size_t)(p - out);
}

// ---------------------------------------------------------------------------
// The IEC task workers
// ---------------------------------------------------------------------------

static void work_main(void *arg)
{
    const uint32_t i = (uint32_t)(uintptr_t)arg;
    Worker &k = s_workers[i];
    uint32_t seen = 0;
    bool sketch_started = false;
    for (;;) {
        // A scan only for a release the dispatcher actually made. A wake-up can
        // also come from elsewhere (a library notifying the task it runs in),
        // and scanning on that one would leave `completed` ahead of `released`,
        // so the task would never be released again.
        uint32_t released;
        while ((released = __atomic_load_n(&k.released, __ATOMIC_ACQUIRE)) == seen) plc_os_wait_notify(UINT32_MAX);
        seen = released;

        if (i == s_sketch_worker && !sketch_started) {
            sketch_started = true;
            if (s_config.sketch_setup) {
                s_config.sketch_setup();
                k.release_us = plc_os_now_us();   // its setup is not release latency
            }
        }
        k.start_us = plc_os_now_us();
        runtime_rtos_worker_cycle(i, k.release_tick);
        // The optional Arduino sketch, after the scan as in the single loop,
        // holding no lock: it may use the network or a bus through their locks.
        if (i == s_sketch_worker && s_config.after_scan) s_config.after_scan();
        k.end_us = plc_os_now_us();
        __atomic_add_fetch(&k.completed, 1, __ATOMIC_RELEASE);
        plc_os_notify(s_dispatcher);
    }
}

// IEC PRIORITY 0 is the highest. Distinct IEC priorities take successive native
// levels down from the top of the backend's band; equal ones share a level. More
// distinct priorities than levels share the bottom one (the editor refuses that
// build, so it is only a safety net).
static uint8_t native_priority(uint32_t w)
{
    const int32_t mine = runtime_rtos_worker_priority(w);
    uint32_t rank = 0;
    for (uint32_t o = 0; o < s_worker_count; ++o) {
        const int32_t theirs = runtime_rtos_worker_priority(o);
        bool counted = false;
        for (uint32_t e = 0; e < o; ++e)
            if (runtime_rtos_worker_priority(e) == theirs) counted = true;
        if (!counted && theirs < mine) ++rank;
    }
    const int level = (int)OPENPLC_RTOS_WORK_PRIORITY - (int)rank;
    return (uint8_t)(level < (int)PLC_OS_PRIO_WORK_BOTTOM ? PLC_OS_PRIO_WORK_BOTTOM : level);
}

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

// Set once service A has started the ports and the network. Service B waits for
// it, because OPC-UA and S7 listen on that network, and so does the first scan
// (for a bounded time), because a program may use the network from its first.
static bool s_service_a_started = false;
// Set by the dispatcher when the first frame is out; the services serve only
// after it, so no client reads a pre-scan image. Set at once when RTOS mode
// could not start, so the editor can still read that it is in ERROR.
static bool s_gate_open = false;

static void open_gate(void)
{
    __atomic_store_n(&s_gate_open, true, __ATOMIC_RELEASE);
    plc_os_notify(s_service_a);
    if (s_service_b) plc_os_notify(s_service_b);
}

static void service_loop(int slot, plc_rtos_hook_t begin, plc_rtos_hook_t pass)
{
    if (slot == 1) {
        while (!__atomic_load_n(&s_service_a_started, __ATOMIC_ACQUIRE)) plc_os_wait_notify(RTOS_SIGNAL_POLL_US);
    }
    // A peripheral is started by the task that uses it (see plc_rtos_config_t).
    if (begin) begin();
    if (slot == 0) {
        __atomic_store_n(&s_service_a_started, true, __ATOMIC_RELEASE);
        plc_os_notify(s_dispatcher);
        if (s_service_b) plc_os_notify(s_service_b);
    }

    while (!__atomic_load_n(&s_gate_open, __ATOMIC_ACQUIRE)) plc_os_wait_notify(RTOS_SIGNAL_POLL_US);

    for (;;) {
        const int64_t t0 = plc_os_now_us();
        pass();
        const uint32_t took = (uint32_t)(plc_os_now_us() - t0);
        if (took > s_service_iter_max_us[slot]) __atomic_store_n(&s_service_iter_max_us[slot], took, __ATOMIC_RELAXED);
        if (slot == 0) sample_health();
        // Block, so the core's idle task runs and the task watchdog stays fed.
        plc_os_yield_tick();
    }
}

#if defined(PLC_OS_ONE_SERVICE_TASK)
// A board with little RAM runs both services in one task, one after the other.
static void services_begin(void)
{
    if (s_config.service_a_begin) s_config.service_a_begin();
    if (s_config.service_b_begin) s_config.service_b_begin();
}

static void services_pass(void)
{
    s_config.service_a();
    if (s_config.service_b) s_config.service_b();
}

static void service_a_main(void *) { service_loop(0, services_begin, services_pass); }
#else
static void service_a_main(void *) { service_loop(0, s_config.service_a_begin, s_config.service_a); }
static void service_b_main(void *) { service_loop(1, s_config.service_b_begin, s_config.service_b); }
#endif

void plc_rtos_count_busy(void)
{
    const int slot = (s_service_b && plc_os_task_self() == s_service_b) ? 1 : 0;
    __atomic_add_fetch(&s_service_busy[slot], 1, __ATOMIC_RELAXED);
}

// ---------------------------------------------------------------------------
// Modbus: the lock each function code needs
// ---------------------------------------------------------------------------

#ifdef MODBUS_ENABLED
// The image into the register banks, so a request reads the current image.
// Same mapping as modbusTask().
static void image_to_banks(void)
{
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; i++)
        if (bool_output[i / 8][i % 8] != NULL) write_discrete(i, COILS, (bool)*bool_output[i / 8][i % 8]);
    for (int i = 0; i < MAX_ANALOG_OUTPUT; i++)
        if (int_output[i] != NULL) modbus.holding[i] = *int_output[i];
    for (int i = 0; i < MAX_DIGITAL_INPUT; i++)
        if (bool_input[i / 8][i % 8] != NULL) write_discrete(i, INPUTSTATUS, (bool)*bool_input[i / 8][i % 8]);
    for (int i = 0; i < MAX_ANALOG_INPUT; i++)
        if (int_input[i] != NULL) modbus.input_regs[i] = *int_input[i];
    for (int i = 0; i < MAX_MEMORY_WORD; i++)
        if (int_memory[i] != NULL) modbus.holding[i + MAX_ANALOG_OUTPUT] = *int_memory[i];
    for (int i = 0; i < MAX_MEMORY_DWORD; i++)
        if (dint_memory[i] != NULL) modbus.dint_memory[i] = *dint_memory[i];
    for (int i = 0; i < MAX_MEMORY_LWORD; i++)
        if (lint_memory[i] != NULL) modbus.lint_memory[i] = *lint_memory[i];
}

// Back into the image: only what the request changed. The banks matched the
// image a moment ago under this same hold, so a difference is the client's
// write. A write to a forced variable's cell is pinned back at the next frame
// output, before the HAL sees it.
static void banks_to_image(void)
{
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; i++) {
        IEC_BOOL *slot = bool_output[i / 8][i % 8];
        if (slot != NULL) {
            const bool coil = get_discrete(i, COILS);
            if (coil != (bool)*slot) *slot = coil;
        }
    }
    for (int i = 0; i < MAX_ANALOG_OUTPUT; i++)
        if (int_output[i] != NULL && *int_output[i] != modbus.holding[i]) *int_output[i] = modbus.holding[i];
    for (int i = 0; i < MAX_MEMORY_WORD; i++)
        if (int_memory[i] != NULL && *int_memory[i] != modbus.holding[i + MAX_ANALOG_OUTPUT])
            *int_memory[i] = modbus.holding[i + MAX_ANALOG_OUTPUT];
    for (int i = 0; i < MAX_MEMORY_DWORD; i++)
        if (dint_memory[i] != NULL && *dint_memory[i] != modbus.dint_memory[i]) *dint_memory[i] = modbus.dint_memory[i];
    for (int i = 0; i < MAX_MEMORY_LWORD; i++)
        if (lint_memory[i] != NULL && *lint_memory[i] != modbus.lint_memory[i]) *lint_memory[i] = modbus.lint_memory[i];
}
#endif // MODBUS_ENABLED

// The tasks whose variables a debugger read touches, from the
// request itself. Bounded by the frame, since the body validates it later.
static uint32_t debug_request_mask(uint8_t fc)
{
    const uint16_t len = mb_frame_len;
    uint32_t mask = 0;
    switch (fc) {
    case MB_FC_DEBUG_GET: {   // [id][FC][arr][start:u16][end:u16]
        if (len < 7) return 0;
        const uint16_t start = (uint16_t)((mb_frame[3] << 8) | mb_frame[4]);
        const uint16_t end   = (uint16_t)((mb_frame[5] << 8) | mb_frame[6]);
        return start <= end ? runtime_rtos_owner_mask_range(mb_frame[2], start, end) : 0;
    }
    case MB_FC_DEBUG_GET_LIST: {   // [id][FC][count:u16][(arr:u8, elem:u16) x count]
        if (len < 4) return 0;
        const uint16_t count = (uint16_t)((mb_frame[2] << 8) | mb_frame[3]);
        for (uint32_t i = 0; i < count && 4u + 3u * i + 2u < len; ++i) {
            const uint8_t *e = &mb_frame[4 + 3 * i];
            mask |= runtime_rtos_owner_mask(e[0], (uint16_t)((e[1] << 8) | e[2]));
        }
        return mask;
    }
    default:
        return 0;
    }
}

void plc_rtos_run_pdu(uint8_t fc, plc_rtos_hook_t pdu_body)
{
    switch (fc) {
    // Data: the register banks mirror the process image.
    case MB_FC_READ_COILS:
    case MB_FC_READ_INPUT_STAT:
    case MB_FC_READ_REGS:
    case MB_FC_READ_INPUT_REGS:
    case MB_FC_WRITE_COIL:
    case MB_FC_WRITE_REG:
    case MB_FC_WRITE_COILS:
    case MB_FC_WRITE_REGS:
#ifdef MODBUS_ENABLED
        runtime_rtos_image_lock();
        image_to_banks();
        pdu_body();
        if (fc == MB_FC_WRITE_COIL || fc == MB_FC_WRITE_REG || fc == MB_FC_WRITE_COILS || fc == MB_FC_WRITE_REGS)
            banks_to_image();
        runtime_rtos_image_unlock();
#else
        pdu_body();   // not built in: answered ILLEGAL_FUNCTION, touching nothing
#endif
        return;

    // The debugger's writes and forces: see runtime_rtos_lock_for_write. A task
    // stalled mid-scan refuses only writes to its own variables.
    case MB_FC_DEBUG_SET: {   // [id][FC][arr][elem:u16][force][len:u16][value]
        // Refused short, before the body could act on stale bytes past the frame
        // with no task's lock taken.
        if (mb_frame_len < 8) {
            exceptionResponse(fc, MB_EX_ILLEGAL_VALUE);
            return;
        }
        runtime_rtos_write_lock_t held;
        if (!runtime_rtos_lock_for_write(mb_frame[2], (uint16_t)((mb_frame[3] << 8) | mb_frame[4]), &held)) {
            plc_rtos_count_busy();
            exceptionResponse(fc, MB_EX_SLAVE_BUSY);
            return;
        }
        pdu_body();
        runtime_rtos_unlock_write(&held);
        return;
    }

    // Reads: between the owners' scans when that comes quickly, and as they
    // stand for an owner stalled mid-scan (see runtime_rtos_lock_workers_for_read).
    case MB_FC_DEBUG_GET:
    case MB_FC_DEBUG_GET_LIST: {
        const uint32_t locked = runtime_rtos_lock_workers_for_read(debug_request_mask(fc));
        pdu_body();
        runtime_rtos_unlock_workers(locked);
        return;
    }

    // Codes that reach HAL or package code (device id, license store,
    // bootloader, lock): that code assumes a single caller, and the HAL's caller
    // is the dispatcher, which holds the image lock while it drives it.
    case MB_FC_DEBUG_GET_DEVICE_ID:
    case MB_FC_DEBUG_WRITE_LICENSE:
    case MB_FC_DEBUG_READ_LICENSE:
    case MB_FC_REBOOT_BOOTLOADER:
    case MB_FC_GET_LOCK_STATE:
        runtime_rtos_image_lock();
        pdu_body();
        runtime_rtos_image_unlock();
        return;

    // Static tables, single-word reads, the statistics snapshot, or a published
    // request (run/stop): no lock.
    default:
        pdu_body();
        return;
    }
}

// ---------------------------------------------------------------------------
// Start-up and the dispatcher
// ---------------------------------------------------------------------------

static void dispatch_forever(void);

#if PLC_OS_OWN_DISPATCHER
static void dispatcher_main(void *) { dispatch_forever(); }
#endif

void plc_rtos_start(const plc_rtos_config_t *config)
{
    s_config = *config;
#if !PLC_OS_OWN_DISPATCHER
    s_dispatcher = plc_os_task_self();
#endif
    // Every RTOS object is made here, at the end of setup() (see
    // runtime_rtos_init). A lock that cannot be made leaves the PLC in ERROR.
    runtime_rtos_init();
    s_stats_lock = plc_os_mutex_create();
    if (!s_stats_lock) runtime_rtos_fault();
    make_bus_locks();
#if defined(STRUCPP_THREADED) && defined(STRUCPP_PLATFORM_THREADS)
    if (!plc_os_platform_locks_ready()) runtime_rtos_fault();
#endif

    runtime_rtos_prepare_workers();
    s_worker_count = runtime_rtos_worker_count();
    if (s_worker_count > RTOS_MAX_WORKERS) s_worker_count = RTOS_MAX_WORKERS;
    // The sketch runs in the fastest task (the first declared of equal ones),
    // so its loop runs as near to every base tick as the tasks allow.
    for (uint32_t w = 1; w < s_worker_count; ++w)
        if (runtime_rtos_worker_divisor(w) < runtime_rtos_worker_divisor(s_sketch_worker)) s_sketch_worker = w;

    // The IEC work beside the dispatcher, on the core setup() runs on; the
    // services on the other core where there is one.
    const int plc_core     = plc_os_current_core();
    const int service_core = plc_os_core_count() > 1 ? (plc_core == 0 ? 1 : 0) : PLC_OS_ANY_CORE;

    // The services first: service A is how the editor learns that something
    // failed, so it gets the memory before the IEC work does.
    if (!plc_os_task_create(service_a_main, nullptr, "plc_modbus", OPENPLC_RTOS_SERVICE_A_STACK,
                            OPENPLC_RTOS_SERVICE_A_PRIORITY, service_core, &s_service_a))
        runtime_rtos_fault();
#if !defined(PLC_OS_ONE_SERVICE_TASK)
    if (s_config.service_b &&
        !plc_os_task_create(service_b_main, nullptr, "plc_protocols", OPENPLC_RTOS_SERVICE_B_STACK,
                            OPENPLC_RTOS_SERVICE_B_PRIORITY, service_core, &s_service_b))
        runtime_rtos_fault();
#endif

    // A task that cannot be created (out of memory) leaves the PLC in ERROR with
    // nothing released, rather than running without it; the rest are then not
    // created either, leaving what memory there is to the services.
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        s_workers[w]         = Worker{};
        s_workers[w].divisor = runtime_rtos_worker_divisor(w);
        window_reset(s_window[w]);
    }
    for (uint32_t w = 0; w < s_worker_count && !faulted(); ++w) {
        if (!plc_os_task_create(work_main, (void *)(uintptr_t)w, runtime_rtos_worker_name(w),
                                OPENPLC_RTOS_WORK_STACK, native_priority(w), plc_core, &s_workers[w].task))
            runtime_rtos_fault();
    }

#if PLC_OS_OWN_DISPATCHER
    if (!plc_os_task_create(dispatcher_main, nullptr, "plc_dispatch", OPENPLC_RTOS_DISPATCH_STACK,
                            OPENPLC_RTOS_DISPATCH_PRIORITY, plc_core, &s_dispatcher)) {
        // No dispatcher to open the services' gate: open it now, so the editor
        // can connect and read the ERROR.
        runtime_rtos_fault();
        open_gate();
    }
    plc_os_start_scheduler();
    // Back here only when the RTOS could not start at all (no memory left for
    // its own idle or timer task): nothing runs and nothing can report it. The
    // build-time memory checks are what keep a board from getting here.
    runtime_rtos_fault();
#else
    plc_os_task_set_priority(nullptr, OPENPLC_RTOS_DISPATCH_PRIORITY);
#endif
}

void plc_rtos_loop(void)
{
#if !PLC_OS_OWN_DISPATCHER
    dispatch_forever();
#endif
}

// Put out the outputs of the workers in `mask` that have finished, and record
// their scans. Returns those still running.
static uint32_t output_finished(uint32_t mask, bool stop_pending)
{
    uint32_t done = 0;
    for (uint32_t w = 0; w < s_worker_count; ++w)
        if ((mask & (1u << w)) && worker_idle(w)) done |= 1u << w;
    if (!done) return mask;
    runtime_rtos_frame_output(all_idle(), stop_pending);
    for (uint32_t w = 0; w < s_worker_count; ++w)
        if (done & (1u << w)) record_scan(w);
    return mask & ~done;
}

// The dispatcher; never returns.
static void dispatch_forever(void)
{
    const uint32_t tick_us    = plc_os_tick_period_us();
    const uint32_t base_ticks = (uint32_t)((base_tick_ns / 1000ULL) / tick_us);
    const uint32_t step       = base_ticks > 0 ? base_ticks : 1;   // the editor refuses a period off the tick
    const uint64_t base_us    = base_tick_ns / 1000ULL;
    // Retain is due every this many base ticks, counted in run_tick like the
    // task releases, so where in its frame a save lands never shifts the next.
    const uint64_t retain_every =
        base_us > 0 ? (OPENPLC_RTOS_RETAIN_PERIOD_US + base_us - 1) / base_us : 1;

    // The first scan waits for service A to bring up the ports and the network,
    // for a bounded time, so a network that never comes up cannot keep the PLC
    // from running.
    const int64_t give_up = plc_os_now_us() + OPENPLC_RTOS_START_WAIT_US;
    while (!__atomic_load_n(&s_service_a_started, __ATOMIC_ACQUIRE)) {
        const int64_t left = give_up - plc_os_now_us();
        if (left <= 0) break;
        plc_os_wait_notify(left < RTOS_SIGNAL_POLL_US ? (uint32_t)left : RTOS_SIGNAL_POLL_US);
    }

    // The grid starts here, after setup().
    plc_os_ticks_t deadline     = plc_os_ticks_now();
    uint64_t       run_tick     = 0;   // base ticks run so far: IEC time is this grid
    uint32_t       pending      = 0;   // released workers whose outputs are not out yet
    bool           stop_pending = false;
    bool           gate_open    = false;
    uint32_t       frames       = 0;
    uint64_t       retain_due   = 0;   // the run_tick the next save is due on

    for (;;) {
        plc_os_sleep_until_tick(deadline);

        // Outputs of tasks that finished after the dispatcher stopped waiting.
        if (pending) pending = output_finished(pending, stop_pending);

        // Run/stop. A STOP zeroes the outputs at once, lets every task finish the
        // scan it is in, then cold-stops the program with every task parked;
        // nothing is released meanwhile. A RUN releases every task on this tick.
        uint8_t state = runtime_rtos_state();
        const uint8_t wanted = runtime_rtos_wanted_state();
        if (state == PLC_STATE_RUNNING && wanted == PLC_STATE_STOPPED) stop_pending = true;
        if (stop_pending && all_idle()) {
            runtime_rtos_enter_stop();
            stop_pending = false;
            state = PLC_STATE_STOPPED;
        } else if (state == PLC_STATE_STOPPED && wanted == PLC_STATE_RUNNING) {
            runtime_rtos_enter_run(run_tick);
            for (uint32_t w = 0; w < s_worker_count; ++w) s_workers[w].next_tick = run_tick;
            retain_due = run_tick;
            state = PLC_STATE_RUNNING;
        }

        runtime_rtos_frame_input(all_idle());
        if (state == PLC_STATE_STOPPED) runtime_rtos_stopped_copy_in();

        // A task that finished since the top of the frame has its outputs put out
        // before it can be released again.
        if (pending) pending = output_finished(pending, stop_pending);

        // Release every task due on this tick. A task still running is skipped
        // and counted as an overrun, never queued.
        uint32_t released = 0;
        if (state == PLC_STATE_RUNNING && !stop_pending) {
            for (uint32_t w = 0; w < s_worker_count; ++w) {
                Worker &k = s_workers[w];
                // Due at its grid point, or at the latest one reached when a
                // late frame skipped past it: a release missed that way is an
                // overrun too, counted and never replayed.
                if (run_tick < k.next_tick) continue;
                const uint64_t missed = (run_tick - k.next_tick) / k.divisor;
                const uint64_t due    = k.next_tick + missed * k.divisor;
                k.next_tick = due + k.divisor;
                s_window[w].overruns += (uint32_t)missed;
                if (!worker_idle(w)) {
                    s_window[w].overruns++;
                    continue;
                }
                k.release_tick = due;
                k.release_us   = plc_os_now_us();
                k.recorded     = false;
                s_window[w].releases++;
                __atomic_store_n(&k.released, k.released + 1, __ATOMIC_RELEASE);
                plc_os_notify(k.task);
                released |= 1u << w;
            }
            scan_counter = (uint32_t)run_tick;
        }

        // Each task's outputs go out as soon as it finishes: a task still busy
        // (a block waiting on the network) never holds the others' back. Those
        // not done by the next tick are output when they are.
        uint32_t waiting = released;
        while (waiting) {
            const uint32_t still = output_finished(waiting, stop_pending);
            if (still != waiting) {
                waiting = still;
                continue;
            }
            const int32_t left = (int32_t)(deadline + step - plc_os_ticks_now());
            if (left <= 0) break;
            plc_os_wait_notify((uint32_t)left * tick_us);
        }
        pending |= waiting;
        if (!released) runtime_rtos_frame_output(all_idle(), stop_pending);   // stopped, or nothing due

        // Retained values, between the owners' scans; a task stalled in a block
        // does not hold them up (runtime_rtos_retain_save). How late a save got,
        // in whole frames past its due tick, is in the statistics.
        if (state == PLC_STATE_RUNNING && !stop_pending && run_tick >= retain_due &&
            runtime_rtos_retain_save()) {
            const uint64_t late = (run_tick - retain_due) * base_us;
            if (late > s_retain_late_max_us)
                s_retain_late_max_us = late > UINT32_MAX ? UINT32_MAX : (uint32_t)late;
            retain_due = run_tick + retain_every;
        }

        // The services start once the first frame is out, or after a hundred
        // frames if a task is still stuck in its first scan.
        ++frames;
        if (!gate_open && ((released && !waiting) || state != PLC_STATE_RUNNING || frames >= 100)) {
            gate_open = true;
            open_gate();
        }

        publish_stats();

        // The next grid point, or, when this frame ran past it, the latest one
        // already due: those in between are skipped, not replayed. Grid time
        // advances through them while running, so IEC time keeps wall-clock time.
        if (state == PLC_STATE_RUNNING) ++run_tick;
        deadline += step;
        const int32_t late = (int32_t)(plc_os_ticks_now() - deadline);
        if (late > 0) {
            const uint32_t missed = (uint32_t)late / step;
            if (missed > 0) {
                deadline += missed * step;
                if (state == PLC_STATE_RUNNING) run_tick += missed;
            }
        }
    }
}

#endif // OPENPLC_RTOS
