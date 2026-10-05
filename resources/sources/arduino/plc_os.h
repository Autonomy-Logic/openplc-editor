// plc_os.h — the operating-system shim RTOS mode runs on.
//
// Everything RTOS mode needs from the RTOS an Arduino core runs goes through the
// calls below. Each RTOS is a backend in Baremetal/plc_os.cpp, a sketch file so
// that an RTOS shipped as an Arduino library (STM32duino FreeRTOS) is found.
//
// Plain C and free of <Arduino.h>, so both the sketch and the runtime library
// (which never sees Arduino.h) can call it. Compiled only when the editor built
// this firmware in RTOS mode (OPENPLC_RTOS, see rtos_config.h).
//
// Units are the same on every backend: stack sizes in BYTES (vanilla FreeRTOS
// counts words, ESP-IDF bytes), time in microseconds, release times in RTOS
// ticks, priorities as the backend's own numbers.

#ifndef OPENPLC_PLC_OS_H
#define OPENPLC_PLC_OS_H

#include "rtos_config.h"

#if OPENPLC_RTOS

#include <stdbool.h>
#include <stdint.h>

// ---- Per-backend constants -------------------------------------------------
//
// Priorities are the backend's own numbers, larger runs first (a backend whose
// RTOS counts the other way converts inside plc_os.cpp). RTOS mode's tasks sit
// below the core's network and radio tasks, so the PLC cannot starve the
// network. PLC_OS_PRIO_WORK_TOP is IEC PRIORITY 0, PLC_OS_PRIO_WORK_BOTTOM the
// lowest level an IEC task maps to.
//
// PLC_OS_OWN_DISPATCHER: the RTOS is not yet running when setup() is, so the
// dispatcher is a task of its own and plc_os_start_scheduler() starts it all.
// Otherwise setup() and loop() already run in an RTOS thread, which becomes the
// dispatcher.
#if defined(OPENPLC_RTOS_FREERTOS_ESP32)
// FreeRTOS on ESP-IDF: 0..24. System tasks: Ethernet receive 15, lwIP 18,
// arduino_events 19, esp_timer 22, WiFi 23.
#define PLC_OS_PRIO_DISPATCH    14
#define PLC_OS_PRIO_WORK_TOP    13
#define PLC_OS_PRIO_WORK_BOTTOM 6
#define PLC_OS_PRIO_SERVICE_A   5
#define PLC_OS_PRIO_SERVICE_B   4
#define PLC_OS_OWN_DISPATCHER   0

#elif defined(OPENPLC_RTOS_FREERTOS_STM32)
// STM32duino FreeRTOS: 0..6 (configMAX_PRIORITIES 7), timer task 2, idle 0.
#define PLC_OS_PRIO_DISPATCH    6
#define PLC_OS_PRIO_WORK_TOP    5
#define PLC_OS_PRIO_WORK_BOTTOM 3
#define PLC_OS_PRIO_SERVICE_A   2
#define PLC_OS_PRIO_SERVICE_B   1
#define PLC_OS_OWN_DISPATCHER   1

#elif defined(OPENPLC_RTOS_FREERTOS_RENESAS)
// The Uno R4's Arduino_FreeRTOS, built with 8 priorities (0..7) by the editor;
// timer task 3, idle 0. 32 KB of RAM.
#define PLC_OS_PRIO_DISPATCH    7
#define PLC_OS_PRIO_WORK_TOP    6
#define PLC_OS_PRIO_WORK_BOTTOM 4
#define PLC_OS_PRIO_SERVICE_A   2
#define PLC_OS_PRIO_SERVICE_B   1
#define PLC_OS_OWN_DISPATCHER   1
#define PLC_OS_SMALL_STACKS     1

#elif defined(OPENPLC_RTOS_FREERTOS_SAMD)
// FreeRTOS_SAMD21: 0..8 (configMAX_PRIORITIES 9), timer task 2, idle 0. 32 KB
// of RAM, a 14 KB FreeRTOS heap.
#define PLC_OS_PRIO_DISPATCH    8
#define PLC_OS_PRIO_WORK_TOP    7
#define PLC_OS_PRIO_WORK_BOTTOM 5
#define PLC_OS_PRIO_SERVICE_A   4
#define PLC_OS_PRIO_SERVICE_B   3
#define PLC_OS_OWN_DISPATCHER   1
#define PLC_OS_SMALL_STACKS     1

#elif defined(OPENPLC_RTOS_FREERTOS_RP2040)
// arduino-pico FreeRTOS SMP: 0..7. USB and lwIP run at 6 on core 0, the
// flash-write idlers at 7, setup()/loop() at 4 on core 0. The PLC work stays on
// core 0, below USB and lwIP; the services have core 1 to themselves, so their
// numbers need not sit below the IEC band.
#define PLC_OS_PRIO_DISPATCH    5
#define PLC_OS_PRIO_WORK_TOP    4
#define PLC_OS_PRIO_WORK_BOTTOM 1
#define PLC_OS_PRIO_SERVICE_A   3
#define PLC_OS_PRIO_SERVICE_B   2
#define PLC_OS_OWN_DISPATCHER   0

#elif defined(OPENPLC_RTOS_MBED_RTX)
// Mbed OS (CMSIS-RTOS2 on RTX): 1..55. The main thread, lwIP and the socket
// threads run at osPriorityNormal (24), the RTX timer and radio at High (40).
#define PLC_OS_PRIO_DISPATCH    23
#define PLC_OS_PRIO_WORK_TOP    22
#define PLC_OS_PRIO_WORK_BOTTOM 17
#define PLC_OS_PRIO_SERVICE_A   15
#define PLC_OS_PRIO_SERVICE_B   14
#define PLC_OS_OWN_DISPATCHER   0

#elif defined(OPENPLC_RTOS_ZEPHYR)
// Zephyr counts the other way (0 is the highest preemptible priority, 14 the
// main thread's); plc_os.cpp converts with 15 - n, giving 1, 2..9, 10, 11, all
// below the cooperative system work queue. The core's RouterBridge (5) and CAN
// callback (10) threads fall inside that band when a sketch starts them.
#define PLC_OS_PRIO_DISPATCH    14
#define PLC_OS_PRIO_WORK_TOP    13
#define PLC_OS_PRIO_WORK_BOTTOM 6
#define PLC_OS_PRIO_SERVICE_A   5
#define PLC_OS_PRIO_SERVICE_B   4
#define PLC_OS_OWN_DISPATCHER   0
#endif

// The most IEC task workers the build has. The editor writes the exact number
// into rtos_config.h; every table indexed by worker is this long, and the
// debugger's owner masks are 32 bits.
#ifndef OPENPLC_RTOS_MAX_WORKERS
#define OPENPLC_RTOS_MAX_WORKERS 32
#endif
#if OPENPLC_RTOS_MAX_WORKERS < 1 || OPENPLC_RTOS_MAX_WORKERS > 32
#error "OPENPLC_RTOS_MAX_WORKERS must be 1 to 32"
#endif

// Stacks, in bytes, on a board with 32 KB of RAM or less: room for one or two
// IEC tasks beside the services, which share one task there (both passes, one
// after the other). plc_rtos.h has the defaults for the rest.
#if defined(PLC_OS_SMALL_STACKS)
#define PLC_OS_ONE_SERVICE_TASK 1
#ifndef OPENPLC_RTOS_WORK_STACK
#define OPENPLC_RTOS_WORK_STACK 2048
#endif
#ifndef OPENPLC_RTOS_SERVICE_A_STACK
#define OPENPLC_RTOS_SERVICE_A_STACK 4096
#endif
#ifndef OPENPLC_RTOS_DISPATCH_STACK
#define OPENPLC_RTOS_DISPATCH_STACK 2048
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef void *plc_os_task_t;
typedef void *plc_os_mutex_t;
typedef uint32_t plc_os_ticks_t;
typedef void (*plc_os_task_fn)(void *arg);

// Any core, for plc_os_task_create(). A pinned core on a single-core chip is
// treated as "any".
#define PLC_OS_ANY_CORE (-1)

// Number of CPU cores the scheduler runs on.
int plc_os_core_count(void);

// The core the calling task is running on. Called from setup(), it is the core
// Arduino runs setup() and loop() on, whatever the board's menu chose.
int plc_os_current_core(void);

// Create a task. `stack_bytes` is in bytes on every backend. Returns false when
// the task could not be created (out of memory).
bool plc_os_task_create(plc_os_task_fn fn, void *arg, const char *name, uint32_t stack_bytes,
                        uint8_t priority, int core, plc_os_task_t *out);

plc_os_task_t plc_os_task_self(void);

// Change a task's priority; NULL is the calling task.
void plc_os_task_set_priority(plc_os_task_t task, uint8_t priority);

// Unused stack the task has never touched, in bytes; NULL is the calling task.
uint32_t plc_os_task_stack_free_bytes(plc_os_task_t task);

// Direct-to-task wake-up. Counting on FreeRTOS and Zephyr, binary on Mbed (two
// wake-ups before the target runs are one), and a wake-up may also come from
// somewhere else (a library notifying the same task), so every waiter re-checks
// the state it is waiting for.
void plc_os_notify(plc_os_task_t task);

// Wait for a notification. `timeout_us` 0 polls, UINT32_MAX waits forever.
// Returns true when one was taken.
bool plc_os_wait_notify(uint32_t timeout_us);

// A priority-inheriting mutex, created once at start-up (a static pool on
// ESP32, Mbed and Zephyr, the RTOS heap elsewhere). Returns NULL when none could
// be made. A NULL mutex is accepted by every call below and locks nothing, so a
// board that failed to start RTOS mode can still report it.
plc_os_mutex_t plc_os_mutex_create(void);
void plc_os_mutex_lock(plc_os_mutex_t mutex);
// Take within `timeout_us` (0 = try once). Returns true when taken.
bool plc_os_mutex_lock_for(plc_os_mutex_t mutex, uint32_t timeout_us);
void plc_os_mutex_unlock(plc_os_mutex_t mutex);

// The same, recursive: the task holding it may take it again, and releases it
// as often as it took it. For locks library code takes (the network and bus
// locks, plc_rtos.h), where one wrapped call may reach another.
plc_os_mutex_t plc_os_rmutex_create(void);
void plc_os_rmutex_lock(plc_os_mutex_t mutex);
bool plc_os_rmutex_lock_for(plc_os_mutex_t mutex, uint32_t timeout_us);
void plc_os_rmutex_unlock(plc_os_mutex_t mutex);

// Monotonic microseconds since boot, 64-bit so it never wraps.
int64_t plc_os_now_us(void);

// The RTOS tick. Release times are whole ticks; a task period must be too.
plc_os_ticks_t plc_os_ticks_now(void);
uint32_t plc_os_tick_period_us(void);

// Block until the tick count reaches `deadline` (returns at once if it has).
// Signed comparison, so it survives the tick counter wrapping.
void plc_os_sleep_until_tick(plc_os_ticks_t deadline);

// Give the CPU away for at least one tick.
void plc_os_yield_tick(void);

// Free heap in bytes, now and the lowest seen since boot (the lowest these calls
// have read where the RTOS keeps no minimum; 0 where the RTOS does not say).
uint32_t plc_os_heap_free(void);
uint32_t plc_os_heap_min_free(void);

// Start the scheduler. Only on a PLC_OS_OWN_DISPATCHER backend, where it
// returns only when the RTOS could not start (no memory left for its own idle
// or timer task).
void plc_os_start_scheduler(void);

#if defined(STRUCPP_THREADED) && defined(STRUCPP_PLATFORM_THREADS)
// STruC++'s locks for shared globals, on a toolchain without <mutex>: one
// recursive, priority-inheriting mutex per global (one for all of them on a
// PLC_OS_SMALL_STACKS board, whose RTOS heap is a few kilobytes). Call once,
// before the first IEC task starts. False when one could not be made.
bool plc_os_platform_locks_ready(void);
#endif

#ifdef __cplusplus
}
#endif

#endif // OPENPLC_RTOS

#endif // OPENPLC_PLC_OS_H
