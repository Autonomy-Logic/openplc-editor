// plc_os.cpp — backends for the RTOS-mode OS shim (plc_os.h).
//
// One backend per RTOS an Arduino core runs: FreeRTOS on ESP32 (ESP-IDF),
// FreeRTOS from a library (STM32, the Uno R4, SAMD21), FreeRTOS SMP on
// arduino-pico, Mbed OS (CMSIS-RTOS2 on RTX) and Zephyr. The editor picks one in
// rtos_config.h. Everything is inside `#if OPENPLC_RTOS`, so a build that is not
// in RTOS mode compiles this file to nothing.
//
// A sketch file rather than part of the runtime library, so the sketch build's
// library discovery finds an RTOS that ships as a library (STM32, SAMD21).

#include "plc_os.h"

#if OPENPLC_RTOS

#include <stdlib.h>
#include <string.h>

#ifndef PLC_OS_MAX_MUTEXES
// A scan lock per IEC task worker, and the image and statistics locks. The
// recursive ones (buses, globals) come from the heap.
#define PLC_OS_MAX_MUTEXES (OPENPLC_RTOS_MAX_WORKERS + 2)
#endif

#ifndef PLC_OS_MAX_TASKS
// RTOS mode's own tasks: the IEC task workers, two services and the dispatcher.
#define PLC_OS_MAX_TASKS (OPENPLC_RTOS_MAX_WORKERS + 3)
#endif

// ---------------------------------------------------------------------------
// Interrupt masking on a single-core Cortex-M, for the few instructions that
// must not be split. Independent of the RTOS, so it is also safe before the
// scheduler runs, where a FreeRTOS critical section leaves interrupts masked on
// some ports.
// ---------------------------------------------------------------------------
#if defined(__arm__) && !defined(OPENPLC_RTOS_FREERTOS_RP2040)
static inline uint32_t irq_save(void)
{
    uint32_t primask;
    __asm volatile("mrs %0, primask\n\tcpsid i" : "=r"(primask)::"memory");
    return primask;
}

static inline void irq_restore(uint32_t primask) { __asm volatile("msr primask, %0" ::"r"(primask) : "memory"); }
#endif

// ---------------------------------------------------------------------------
// Zephyr cannot report a stack's high-water mark to a loadable sketch, so the
// shim allocates those stacks itself, fills them with a pattern, and counts
// how much of it is still there.
// ---------------------------------------------------------------------------
#if defined(OPENPLC_RTOS_ZEPHYR)
#define PLC_OS_STACK_FILL 0xA5u

static void *stack_alloc(uint32_t bytes)
{
    void *stack = malloc(bytes);   // 8-byte aligned on this toolchain
    if (stack) memset(stack, PLC_OS_STACK_FILL, bytes);
    return stack;
}

// Stacks grow down, so the untouched bytes are at the low end.
static uint32_t stack_untouched(const void *stack, uint32_t bytes)
{
    const uint8_t *p = (const uint8_t *)stack;
    uint32_t n = 0;
    while (n < bytes && p[n] == PLC_OS_STACK_FILL) ++n;
    return n;
}
#endif

#if defined(OPENPLC_RTOS_FREERTOS_ESP32)
// ===========================================================================
// FreeRTOS as shipped by the ESP32 Arduino core (ESP-IDF 4.4 and 5.x)
// ===========================================================================

#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"
#include "sdkconfig.h"

// The editor checked every task period against this tick (OPENPLC_RTOS_TICK_NS
// in rtos_config.h); a board configured otherwise would round them silently.
#if defined(OPENPLC_RTOS_TICK_NS)
static_assert(OPENPLC_RTOS_TICK_NS == (unsigned long)portTICK_PERIOD_MS * 1000000UL,
              "RTOS tick differs from the one the editor checked task periods against");
#endif

// Mutexes come from a fixed pool of static storage: no heap after start-up,
// and no allocation failure in the middle of a scan.
static StaticSemaphore_t s_mutex_storage[PLC_OS_MAX_MUTEXES];
static uint8_t s_mutex_count = 0;

extern "C" {

int plc_os_core_count(void) { return portNUM_PROCESSORS; }

int plc_os_current_core(void) { return (int)xPortGetCoreID(); }

bool plc_os_task_create(plc_os_task_fn fn, void *arg, const char *name, uint32_t stack_bytes,
                        uint8_t priority, int core, plc_os_task_t *out)
{
    // ESP-IDF counts stack depth in BYTES (task.h).
    const BaseType_t affinity =
        (core == PLC_OS_ANY_CORE || core >= portNUM_PROCESSORS) ? tskNO_AFFINITY : (BaseType_t)core;
    TaskHandle_t handle = NULL;
    const BaseType_t ok = xTaskCreatePinnedToCore(fn, name, stack_bytes, arg, priority, &handle, affinity);
    if (out) *out = (plc_os_task_t)handle;
    return ok == pdPASS;
}

uint32_t plc_os_task_stack_free_bytes(plc_os_task_t task)
{
    // Bytes on ESP-IDF, like the stack size.
    return (uint32_t)uxTaskGetStackHighWaterMark((TaskHandle_t)task);
}

plc_os_mutex_t plc_os_mutex_create(void)
{
    if (s_mutex_count >= PLC_OS_MAX_MUTEXES) return NULL;
    // A FreeRTOS mutex (not a binary semaphore) is what carries priority
    // inheritance: a low-priority holder is raised while a PLC task waits.
    return (plc_os_mutex_t)xSemaphoreCreateMutexStatic(&s_mutex_storage[s_mutex_count++]);
}

plc_os_mutex_t plc_os_rmutex_create(void) { return (plc_os_mutex_t)xSemaphoreCreateRecursiveMutex(); }

int64_t plc_os_now_us(void) { return esp_timer_get_time(); }

void plc_os_sleep_until_tick(plc_os_ticks_t deadline)
{
    // vTaskDelayUntil wakes at exactly `previous + increment`, so with `previous`
    // read from the clock the wake lands on `deadline` even if a tick slips in
    // before the call. `previous` must not be in the future: FreeRTOS reads that
    // as a wrapped tick counter and returns at once. ESP-IDF 4.4 has no
    // xTaskDelayUntil.
    TickType_t now = xTaskGetTickCount();
    const int32_t remaining = (int32_t)(deadline - (plc_os_ticks_t)now);
    if (remaining <= 0) return;
    vTaskDelayUntil(&now, (TickType_t)remaining);
}

uint32_t plc_os_heap_free(void) { return (uint32_t)heap_caps_get_free_size(MALLOC_CAP_INTERNAL); }

uint32_t plc_os_heap_min_free(void) { return (uint32_t)heap_caps_get_minimum_free_size(MALLOC_CAP_INTERNAL); }

void plc_os_start_scheduler(void) {}   // already running under setup()

} // extern "C"

#elif defined(OPENPLC_RTOS_FREERTOS_STM32) || defined(OPENPLC_RTOS_FREERTOS_RENESAS) || defined(OPENPLC_RTOS_FREERTOS_SAMD)
// ===========================================================================
// FreeRTOS on one core, from a library: STM32duino FreeRTOS, the Renesas core's
// Arduino_FreeRTOS (Uno R4) and FreeRTOS_SAMD21. The scheduler is not running
// under setup(); plc_rtos_start() creates the dispatcher and starts it. (The Uno
// R4's core is not asked to start it before setup(): its 4 KB loop thread would
// take a third of the RTOS heap.)
// ===========================================================================

#include <Arduino.h>
#if defined(OPENPLC_RTOS_FREERTOS_STM32)
#include <STM32FreeRTOS.h>
#elif defined(OPENPLC_RTOS_FREERTOS_RENESAS)
#include <Arduino_FreeRTOS.h>
#else
#include <FreeRTOS_SAMD21.h>
#endif

#if defined(OPENPLC_RTOS_TICK_NS)
static_assert(OPENPLC_RTOS_TICK_NS == (unsigned long)portTICK_PERIOD_MS * 1000000UL,
              "RTOS tick differs from the one the editor checked task periods against");
#endif

// What a task and a mutex take from the RTOS heap: the stack, the control block
// and the heap's own header, rounded up. STM32duino FreeRTOS builds with
// configUSE_NEWLIB_REENTRANT, so its control block also holds a newlib _reent.
#if defined(OPENPLC_RTOS_FREERTOS_STM32)
#define PLC_OS_TASK_COST(stack_bytes) ((stack_bytes) + 448U)
#else
#define PLC_OS_TASK_COST(stack_bytes) ((stack_bytes) + 160U)
#endif
#define PLC_OS_MUTEX_COST 96U

// The scheduler makes tasks of its own when it starts: the idle task, and the
// timer task with its command queue where timers are on.
#if configUSE_TIMERS
#define PLC_OS_TIMER_TASK_BYTES                                                         \
    (PLC_OS_TASK_COST((unsigned)configTIMER_TASK_STACK_DEPTH * sizeof(StackType_t)) + \
     (unsigned)configTIMER_QUEUE_LENGTH * 16U + 96U)
#else
#define PLC_OS_TIMER_TASK_BYTES 0U
#endif
#define PLC_OS_START_RESERVE \
    (PLC_OS_TASK_COST((unsigned)configMINIMAL_STACK_SIZE * sizeof(StackType_t)) + PLC_OS_TIMER_TASK_BYTES)

#if defined(OPENPLC_RTOS_FREERTOS_RENESAS) || defined(OPENPLC_RTOS_FREERTOS_SAMD)
// These two take every task, stack and mutex from a fixed heap array
// (configTOTAL_HEAP_SIZE), so whether RTOS mode fits is known now: refuse the
// build rather than a board that stops at boot. The stack sizes are the small
// board's (plc_os.h).
static_assert(configTOTAL_HEAP_SIZE >=
                  OPENPLC_RTOS_MAX_WORKERS * PLC_OS_TASK_COST(OPENPLC_RTOS_WORK_STACK) +
                      PLC_OS_TASK_COST(OPENPLC_RTOS_SERVICE_A_STACK) + PLC_OS_TASK_COST(OPENPLC_RTOS_DISPATCH_STACK) +
                      PLC_OS_START_RESERVE +
                      (OPENPLC_RTOS_MAX_WORKERS + 8U) * PLC_OS_MUTEX_COST,
              "RTOS mode's tasks do not fit this board's RTOS heap: run fewer IEC tasks, or turn RTOS mode off");
#endif

// Refuse an allocation that would fail, so RTOS mode reports ERROR instead:
// FreeRTOS_SAMD21's malloc-failed hook halts the board, and a scheduler left
// without room for its own tasks cannot start.
static bool heap_has(uint32_t bytes) { return xPortGetFreeHeapSize() >= bytes; }

static uint32_t s_heap_min = UINT32_MAX;

extern "C" {

#if !defined(OPENPLC_RTOS_FREERTOS_RENESAS)
// The library's idle hook calls loop(). In RTOS mode loop() has nothing to do,
// and the idle task must never run PLC code. (The Uno R4's sleeps until the
// next interrupt; it stays.)
void vApplicationIdleHook(void) {}
#endif

#if defined(OPENPLC_RTOS_FREERTOS_SAMD) || defined(OPENPLC_RTOS_FREERTOS_RENESAS)
// newlib's malloc (used by `new`, String and the network libraries) has no lock
// on these two cores, and in RTOS mode several tasks allocate; STM32duino
// FreeRTOS supplies its own. Suspending the scheduler is enough on one core.
void __malloc_lock(struct _reent *) { vTaskSuspendAll(); }
void __malloc_unlock(struct _reent *) { (void)xTaskResumeAll(); }
#endif

int plc_os_core_count(void) { return 1; }

int plc_os_current_core(void) { return 0; }

bool plc_os_task_create(plc_os_task_fn fn, void *arg, const char *name, uint32_t stack_bytes,
                        uint8_t priority, int core, plc_os_task_t *out)
{
    (void)core;
    if (out) *out = NULL;
    // Every task is made before the scheduler starts, so each leaves room for its own.
    if (!heap_has(PLC_OS_TASK_COST(stack_bytes) + PLC_OS_START_RESERVE)) return false;
    TaskHandle_t handle = NULL;
    // Vanilla FreeRTOS counts stack depth in words.
    const BaseType_t ok =
        xTaskCreate(fn, name, (configSTACK_DEPTH_TYPE)(stack_bytes / sizeof(StackType_t)), arg, priority, &handle);
    if (out) *out = (plc_os_task_t)handle;
    return ok == pdPASS;
}

uint32_t plc_os_task_stack_free_bytes(plc_os_task_t task)
{
    return (uint32_t)uxTaskGetStackHighWaterMark((TaskHandle_t)task) * sizeof(StackType_t);
}

plc_os_mutex_t plc_os_mutex_create(void)
{
    return heap_has(PLC_OS_MUTEX_COST) ? (plc_os_mutex_t)xSemaphoreCreateMutex() : NULL;
}

plc_os_mutex_t plc_os_rmutex_create(void)
{
    return heap_has(PLC_OS_MUTEX_COST) ? (plc_os_mutex_t)xSemaphoreCreateRecursiveMutex() : NULL;
}

int64_t plc_os_now_us(void)
{
    // micros() wraps every 71 minutes; it is extended to 64 bits by placing each
    // reading next to the last one kept, by the signed difference (right within
    // 35 minutes; the dispatcher reads the clock every frame). A reading older
    // than the last kept comes out earlier rather than as a wrap. micros() is
    // read before masking: with the tick interrupt held off it can step back.
    static int64_t s_last_us = 0;
    const uint32_t now = micros();
    const uint32_t key = irq_save();
    const int64_t us = s_last_us + (int32_t)(now - (uint32_t)s_last_us);
    if (us > s_last_us) s_last_us = us;
    irq_restore(key);
    return us;
}

void plc_os_sleep_until_tick(plc_os_ticks_t deadline)
{
    // See the ESP32 backend: `previous` read from the clock, never in the future.
    TickType_t now = xTaskGetTickCount();
    const int32_t remaining = (int32_t)(deadline - (plc_os_ticks_t)now);
    if (remaining <= 0) return;
    vTaskDelayUntil(&now, (TickType_t)remaining);
}

uint32_t plc_os_heap_free(void)
{
    const uint32_t free_now = (uint32_t)xPortGetFreeHeapSize();
    if (free_now < s_heap_min) s_heap_min = free_now;
    return free_now;
}

uint32_t plc_os_heap_min_free(void)
{
    plc_os_heap_free();
    return s_heap_min;
}

void plc_os_start_scheduler(void) { vTaskStartScheduler(); }

} // extern "C"

#elif defined(OPENPLC_RTOS_FREERTOS_RP2040)
// ===========================================================================
// FreeRTOS SMP from arduino-pico (the core's Operating System menu, which the
// editor sets), on both cores of an RP2040 or RP2350. It is already running
// under setup(), which runs in a task pinned to core 0.
// ===========================================================================

#include <Arduino.h>
#include <FreeRTOS.h>
#include <semphr.h>
#include <task.h>

#if defined(OPENPLC_RTOS_TICK_NS)
static_assert(OPENPLC_RTOS_TICK_NS == (unsigned long)portTICK_PERIOD_MS * 1000000UL,
              "RTOS tick differs from the one the editor checked task periods against");
#endif

static uint32_t s_heap_min = UINT32_MAX;

extern "C" {

int plc_os_core_count(void) { return configNUMBER_OF_CORES; }

int plc_os_current_core(void) { return (int)get_core_num(); }

bool plc_os_task_create(plc_os_task_fn fn, void *arg, const char *name, uint32_t stack_bytes,
                        uint8_t priority, int core, plc_os_task_t *out)
{
    TaskHandle_t handle = NULL;
    // Pinned from creation, so it never starts on the other core. Stack depth
    // is in words.
    const UBaseType_t affinity =
        (core >= 0 && core < configNUMBER_OF_CORES) ? (UBaseType_t)(1U << core) : tskNO_AFFINITY;
    const BaseType_t ok = xTaskCreateAffinitySet(fn, name, (configSTACK_DEPTH_TYPE)(stack_bytes / sizeof(StackType_t)),
                                                 arg, priority, affinity, &handle);
    if (out) *out = (plc_os_task_t)handle;
    return ok == pdPASS;
}

uint32_t plc_os_task_stack_free_bytes(plc_os_task_t task)
{
    return (uint32_t)uxTaskGetStackHighWaterMark((TaskHandle_t)task) * sizeof(StackType_t);
}

plc_os_mutex_t plc_os_mutex_create(void) { return (plc_os_mutex_t)xSemaphoreCreateMutex(); }

plc_os_mutex_t plc_os_rmutex_create(void) { return (plc_os_mutex_t)xSemaphoreCreateRecursiveMutex(); }

// The SDK's 64-bit microsecond timer, the same on both cores.
int64_t plc_os_now_us(void) { return (int64_t)time_us_64(); }

void plc_os_sleep_until_tick(plc_os_ticks_t deadline)
{
    // See the ESP32 backend: `previous` read from the clock, never in the future.
    TickType_t now = xTaskGetTickCount();
    const int32_t remaining = (int32_t)(deadline - (plc_os_ticks_t)now);
    if (remaining <= 0) return;
    vTaskDelayUntil(&now, (TickType_t)remaining);
}

// The core's heap is newlib's malloc, which FreeRTOS's own counters do not see.
uint32_t plc_os_heap_free(void)
{
    const int free_now = rp2040.getFreeHeap();
    const uint32_t bytes = free_now > 0 ? (uint32_t)free_now : 0U;
    if (bytes < s_heap_min) s_heap_min = bytes;
    return bytes;
}

uint32_t plc_os_heap_min_free(void)
{
    plc_os_heap_free();
    return s_heap_min;
}

void plc_os_start_scheduler(void) {}   // already running under setup()

} // extern "C"

#elif defined(OPENPLC_RTOS_MBED_RTX)
// ===========================================================================
// Mbed OS: CMSIS-RTOS2 on RTX, always running; setup() and loop() run in its
// main thread. The kernel has no object pools, so every object is given its
// control block.
// ===========================================================================

#include <malloc.h>

#include "cmsis_os2.h"
#include "hal/us_ticker_api.h"
#include "mbed_stats.h"
#include "rtx_os.h"

#if defined(OPENPLC_RTOS_TICK_NS)
// mbed_rtx_conf.h fixes the kernel tick at 1 kHz.
static_assert(OPENPLC_RTOS_TICK_NS == 1000000UL, "RTOS tick differs from the one the editor checked task periods against");
#endif

static osRtxMutex_t s_mutex_cb[PLC_OS_MAX_MUTEXES];
static uint8_t s_mutex_count = 0;

struct PlcOsThread {
    osRtxThread_t cb;
    void *stack;
};
static PlcOsThread s_threads[PLC_OS_MAX_TASKS];
static uint8_t s_thread_count = 0;
static uint32_t s_heap_min = UINT32_MAX;

static uint32_t us_to_ticks_ceil(uint32_t us)
{
    const uint64_t tick_us = 1000000U / osKernelGetTickFreq();
    return (uint32_t)(((uint64_t)us + tick_us - 1U) / tick_us);
}

extern "C" {

int plc_os_core_count(void) { return 1; }

int plc_os_current_core(void) { return 0; }

bool plc_os_task_create(plc_os_task_fn fn, void *arg, const char *name, uint32_t stack_bytes,
                        uint8_t priority, int core, plc_os_task_t *out)
{
    (void)core;
    if (out) *out = NULL;
    if (s_thread_count >= PLC_OS_MAX_TASKS) return false;
    PlcOsThread &t = s_threads[s_thread_count];
    // RTX fills the stack with its own watermark pattern at creation (the
    // variants build with MBED_ALL_STATS_ENABLED), which osThreadGetStackSpace()
    // reads back; a pattern of ours would only be overwritten.
    t.stack = malloc(stack_bytes);   // 8-byte aligned, as RTX requires
    if (!t.stack) return false;
    osThreadAttr_t attr;
    memset(&attr, 0, sizeof(attr));
    attr.name       = name;
    attr.cb_mem     = &t.cb;
    attr.cb_size    = sizeof(t.cb);
    attr.stack_mem  = t.stack;
    attr.stack_size = stack_bytes;
    attr.priority   = (osPriority_t)priority;
    const osThreadId_t id = osThreadNew((osThreadFunc_t)fn, arg, &attr);
    if (!id) {
        free(t.stack);
        return false;
    }
    ++s_thread_count;
    if (out) *out = (plc_os_task_t)id;
    return true;
}

plc_os_task_t plc_os_task_self(void) { return (plc_os_task_t)osThreadGetId(); }

void plc_os_task_set_priority(plc_os_task_t task, uint8_t priority)
{
    osThreadSetPriority(task ? (osThreadId_t)task : osThreadGetId(), (osPriority_t)priority);
}

uint32_t plc_os_task_stack_free_bytes(plc_os_task_t task)
{
    // From RTX's own watermark: 0 on a build without stack statistics.
    return osThreadGetStackSpace(task ? (osThreadId_t)task : osThreadGetId());
}

// Thread flags are binary, not counting; every waiter in RTOS mode re-checks
// the state it waits on, so a wake-up that merges with another loses nothing.
void plc_os_notify(plc_os_task_t task)
{
    if (task) osThreadFlagsSet((osThreadId_t)task, 1U);
}

bool plc_os_wait_notify(uint32_t timeout_us)
{
    const uint32_t ticks = (timeout_us == UINT32_MAX) ? osWaitForever : us_to_ticks_ceil(timeout_us);
    const uint32_t flags = osThreadFlagsWait(1U, osFlagsWaitAny, ticks);
    return (flags & osFlagsError) == 0U;
}

plc_os_mutex_t plc_os_mutex_create(void)
{
    if (s_mutex_count >= PLC_OS_MAX_MUTEXES) return NULL;
    osMutexAttr_t attr;
    memset(&attr, 0, sizeof(attr));
    attr.attr_bits = osMutexPrioInherit;
    attr.cb_mem    = &s_mutex_cb[s_mutex_count];
    attr.cb_size   = sizeof(s_mutex_cb[0]);
    const osMutexId_t m = osMutexNew(&attr);
    if (m) ++s_mutex_count;
    return (plc_os_mutex_t)m;
}

void plc_os_mutex_lock(plc_os_mutex_t mutex)
{
    if (mutex) osMutexAcquire((osMutexId_t)mutex, osWaitForever);
}

bool plc_os_mutex_lock_for(plc_os_mutex_t mutex, uint32_t timeout_us)
{
    return !mutex || osMutexAcquire((osMutexId_t)mutex, us_to_ticks_ceil(timeout_us)) == osOK;
}

void plc_os_mutex_unlock(plc_os_mutex_t mutex)
{
    if (mutex) osMutexRelease((osMutexId_t)mutex);
}

// Recursive ones, their control blocks from the heap: there is one per STruC++
// global, as many as the project has.
plc_os_mutex_t plc_os_rmutex_create(void)
{
    osRtxMutex_t *cb = (osRtxMutex_t *)malloc(sizeof(osRtxMutex_t));
    if (!cb) return NULL;
    osMutexAttr_t attr;
    memset(&attr, 0, sizeof(attr));
    attr.attr_bits = osMutexRecursive | osMutexPrioInherit;
    attr.cb_mem    = cb;
    attr.cb_size   = sizeof(*cb);
    const osMutexId_t m = osMutexNew(&attr);
    if (!m) free(cb);
    return (plc_os_mutex_t)m;
}

void plc_os_rmutex_lock(plc_os_mutex_t mutex) { plc_os_mutex_lock(mutex); }

bool plc_os_rmutex_lock_for(plc_os_mutex_t mutex, uint32_t timeout_us) { return plc_os_mutex_lock_for(mutex, timeout_us); }

void plc_os_rmutex_unlock(plc_os_mutex_t mutex) { plc_os_mutex_unlock(mutex); }

int64_t plc_os_now_us(void) { return (int64_t)ticker_read_us(get_us_ticker_data()); }

plc_os_ticks_t plc_os_ticks_now(void) { return (plc_os_ticks_t)osKernelGetTickCount(); }

uint32_t plc_os_tick_period_us(void) { return 1000000U / osKernelGetTickFreq(); }

void plc_os_sleep_until_tick(plc_os_ticks_t deadline)
{
    const int32_t remaining = (int32_t)(deadline - (plc_os_ticks_t)osKernelGetTickCount());
    if (remaining <= 0) return;
    osDelayUntil((uint32_t)deadline);
}

void plc_os_yield_tick(void) { osDelay(1U); }

uint32_t plc_os_heap_free(void)
{
    // Mbed's own heap statistics (the variants build with them): what the heap
    // region holds that is not allocated. mallinfo() counts only what the
    // allocator has already taken from that region.
    mbed_stats_heap_t heap;
    memset(&heap, 0, sizeof(heap));
    mbed_stats_heap_get(&heap);
    uint32_t free_now;
    if (heap.reserved_size > 0) {
        free_now = heap.reserved_size > heap.current_size ? heap.reserved_size - heap.current_size : 0U;
        const uint32_t floor = heap.reserved_size > heap.max_size ? heap.reserved_size - heap.max_size : 0U;
        if (floor < s_heap_min) s_heap_min = floor;
    } else {
        free_now = (uint32_t)mallinfo().fordblks;
        if (free_now < s_heap_min) s_heap_min = free_now;
    }
    return free_now;
}

uint32_t plc_os_heap_min_free(void)
{
    plc_os_heap_free();
    return s_heap_min;
}

void plc_os_start_scheduler(void) {}   // already running under setup()

} // extern "C"

#elif defined(OPENPLC_RTOS_ZEPHYR)
// ===========================================================================
// Zephyr (the Arduino Zephyr core): setup() and loop() run in its main thread.
// A thread has no notification of its own, so each gets a counting semaphore,
// found through a small table. Priorities count the other way: 15 - n.
// ===========================================================================

#include <zephyr/kernel.h>

#if defined(OPENPLC_RTOS_TICK_NS)
static_assert(OPENPLC_RTOS_TICK_NS == 1000000000UL / CONFIG_SYS_CLOCK_TICKS_PER_SEC,
              "RTOS tick differs from the one the editor checked task periods against");
#endif

static inline int zephyr_priority(uint8_t priority) { return 15 - (int)priority; }

struct PlcOsThread {
    struct k_thread thread;
    k_tid_t tid;
    struct k_sem wake;
    void *stack;
    uint32_t stack_bytes;
    plc_os_task_fn fn;
    void *arg;
};
static PlcOsThread s_threads[PLC_OS_MAX_TASKS];
static uint8_t s_thread_count = 0;   // records in use: appended, never removed
static struct k_mutex s_mutexes[PLC_OS_MAX_MUTEXES];
static uint8_t s_mutex_count = 0;
static struct k_spinlock s_table_lock;   // taken to append only

static void thread_entry(void *self, void *, void *)
{
    PlcOsThread *t = (PlcOsThread *)self;
    t->fn(t->arg);
}

// Take the next record, or NULL when the table is full.
static PlcOsThread *reserve_entry(void)
{
    const k_spinlock_key_t key = k_spin_lock(&s_table_lock);
    PlcOsThread *t = nullptr;
    if (s_thread_count < PLC_OS_MAX_TASKS) {
        t = &s_threads[s_thread_count];
        __atomic_store_n(&s_thread_count, (uint8_t)(s_thread_count + 1), __ATOMIC_RELEASE);
    }
    k_spin_unlock(&s_table_lock, key);
    return t;
}

// The calling thread's record. Found without a lock (every IEC TIME() call
// comes here): a record's `tid` is set before its thread starts, and a thread
// only ever looks for itself. A thread the shim did not create (the main
// thread, which becomes the dispatcher) is given one the first time it asks.
static PlcOsThread *self_entry(void)
{
    const k_tid_t me = k_current_get();
    const uint8_t n = __atomic_load_n(&s_thread_count, __ATOMIC_ACQUIRE);
    for (uint8_t i = 0; i < n; ++i)
        if (__atomic_load_n(&s_threads[i].tid, __ATOMIC_ACQUIRE) == me) return &s_threads[i];
    PlcOsThread *t = reserve_entry();
    if (t) {
        t->stack = nullptr;
        k_sem_init(&t->wake, 0, K_SEM_MAX_LIMIT);
        __atomic_store_n(&t->tid, me, __ATOMIC_RELEASE);
    }
    return t;
}

static k_timeout_t us_timeout(uint32_t us)
{
    return us == UINT32_MAX ? K_FOREVER : us == 0U ? K_NO_WAIT : K_USEC(us);
}

extern "C" {

int plc_os_core_count(void) { return 1; }

int plc_os_current_core(void) { return 0; }

bool plc_os_task_create(plc_os_task_fn fn, void *arg, const char *name, uint32_t stack_bytes,
                        uint8_t priority, int core, plc_os_task_t *out)
{
    (void)core;
    (void)name;
    if (out) *out = NULL;
    void *stack = stack_alloc(stack_bytes);
    if (!stack) return false;
    PlcOsThread *t = reserve_entry();
    if (!t) {
        free(stack);
        return false;
    }
    t->stack       = stack;
    t->stack_bytes = stack_bytes;
    t->fn          = fn;
    t->arg         = arg;
    k_sem_init(&t->wake, 0, K_SEM_MAX_LIMIT);
    // Created stopped, and started only once the record names it: a thread of
    // higher priority than its creator runs the moment it starts, and it looks
    // itself up by `tid` straight away.
    const k_tid_t tid = k_thread_create(&t->thread, (k_thread_stack_t *)stack, stack_bytes, thread_entry, t, nullptr,
                                        nullptr, zephyr_priority(priority), 0, K_FOREVER);
    if (!tid) {
        free(stack);   // the record stays unused (no tid): nothing finds it
        return false;
    }
    __atomic_store_n(&t->tid, tid, __ATOMIC_RELEASE);
    if (out) *out = (plc_os_task_t)t;
    k_thread_start(tid);
    return true;
}

plc_os_task_t plc_os_task_self(void) { return (plc_os_task_t)self_entry(); }

void plc_os_task_set_priority(plc_os_task_t task, uint8_t priority)
{
    PlcOsThread *t = task ? (PlcOsThread *)task : self_entry();
    if (t) k_thread_priority_set(t->tid, zephyr_priority(priority));
}

uint32_t plc_os_task_stack_free_bytes(plc_os_task_t task)
{
    const PlcOsThread *t = task ? (const PlcOsThread *)task : self_entry();
    return (t && t->stack) ? stack_untouched(t->stack, t->stack_bytes) : 0;
}

void plc_os_notify(plc_os_task_t task)
{
    if (task) k_sem_give(&((PlcOsThread *)task)->wake);
}

bool plc_os_wait_notify(uint32_t timeout_us)
{
    PlcOsThread *t = self_entry();
    return t && k_sem_take(&t->wake, us_timeout(timeout_us)) == 0;
}

plc_os_mutex_t plc_os_mutex_create(void)
{
    if (s_mutex_count >= PLC_OS_MAX_MUTEXES) return NULL;
    // Zephyr's mutex inherits priority on its own.
    struct k_mutex *m = &s_mutexes[s_mutex_count++];
    k_mutex_init(m);
    return (plc_os_mutex_t)m;
}

void plc_os_mutex_lock(plc_os_mutex_t mutex)
{
    if (mutex) k_mutex_lock((struct k_mutex *)mutex, K_FOREVER);
}

bool plc_os_mutex_lock_for(plc_os_mutex_t mutex, uint32_t timeout_us)
{
    return !mutex || k_mutex_lock((struct k_mutex *)mutex, us_timeout(timeout_us)) == 0;
}

void plc_os_mutex_unlock(plc_os_mutex_t mutex)
{
    if (mutex) k_mutex_unlock((struct k_mutex *)mutex);
}

// Zephyr's mutexes are recursive already; these come from the heap, one per
// STruC++ global.
plc_os_mutex_t plc_os_rmutex_create(void)
{
    struct k_mutex *m = (struct k_mutex *)malloc(sizeof(struct k_mutex));
    if (m) k_mutex_init(m);
    return (plc_os_mutex_t)m;
}

void plc_os_rmutex_lock(plc_os_mutex_t mutex) { plc_os_mutex_lock(mutex); }

bool plc_os_rmutex_lock_for(plc_os_mutex_t mutex, uint32_t timeout_us) { return plc_os_mutex_lock_for(mutex, timeout_us); }

void plc_os_rmutex_unlock(plc_os_mutex_t mutex) { plc_os_mutex_unlock(mutex); }

int64_t plc_os_now_us(void) { return (int64_t)k_cyc_to_us_floor64(k_cycle_get_64()); }

plc_os_ticks_t plc_os_ticks_now(void) { return (plc_os_ticks_t)k_uptime_ticks(); }

uint32_t plc_os_tick_period_us(void) { return 1000000U / CONFIG_SYS_CLOCK_TICKS_PER_SEC; }

void plc_os_sleep_until_tick(plc_os_ticks_t deadline)
{
    const int64_t now = k_uptime_ticks();
    const int32_t remaining = (int32_t)(deadline - (plc_os_ticks_t)now);
    if (remaining <= 0) return;
#if defined(CONFIG_TIMEOUT_64BIT)
    // Absolute: Zephyr adds a tick to a relative timeout, so every frame would
    // start a tick late.
    k_sleep(K_TIMEOUT_ABS_TICKS(now + remaining));
#else
    k_sleep(K_TICKS(remaining));
#endif
}

void plc_os_yield_tick(void) { k_sleep(K_TICKS(1)); }

// The Arduino Zephyr loader exports no heap statistics to a sketch: 0 means
// "not known" to the editor.
uint32_t plc_os_heap_free(void) { return 0; }

uint32_t plc_os_heap_min_free(void) { return 0; }

void plc_os_start_scheduler(void) {}   // already running under setup()

} // extern "C"

#else
#error "RTOS mode is on (OPENPLC_RTOS) but this firmware has no OS backend for the board's core."
#endif // backend

#if defined(OPENPLC_RTOS_FREERTOS_ESP32) || defined(OPENPLC_RTOS_FREERTOS_STM32) || \
    defined(OPENPLC_RTOS_FREERTOS_RENESAS) || defined(OPENPLC_RTOS_FREERTOS_SAMD) || defined(OPENPLC_RTOS_FREERTOS_RP2040)
// ---------------------------------------------------------------------------
// Common to the FreeRTOS backends above.
// ---------------------------------------------------------------------------

static TickType_t us_to_ticks_ceil(uint32_t us)
{
    const uint64_t tick_us = (uint64_t)portTICK_PERIOD_MS * 1000U;
    return (TickType_t)(((uint64_t)us + tick_us - 1U) / tick_us);
}

extern "C" {

plc_os_task_t plc_os_task_self(void) { return (plc_os_task_t)xTaskGetCurrentTaskHandle(); }

void plc_os_task_set_priority(plc_os_task_t task, uint8_t priority)
{
    vTaskPrioritySet((TaskHandle_t)task, priority);
}

void plc_os_notify(plc_os_task_t task)
{
    if (task) xTaskNotifyGive((TaskHandle_t)task);
}

bool plc_os_wait_notify(uint32_t timeout_us)
{
    const TickType_t ticks = (timeout_us == UINT32_MAX) ? portMAX_DELAY : us_to_ticks_ceil(timeout_us);
    return ulTaskNotifyTake(pdFALSE, ticks) > 0;
}

void plc_os_mutex_lock(plc_os_mutex_t mutex)
{
    if (mutex) xSemaphoreTake((SemaphoreHandle_t)mutex, portMAX_DELAY);
}

bool plc_os_mutex_lock_for(plc_os_mutex_t mutex, uint32_t timeout_us)
{
    return !mutex || xSemaphoreTake((SemaphoreHandle_t)mutex, us_to_ticks_ceil(timeout_us)) == pdTRUE;
}

void plc_os_mutex_unlock(plc_os_mutex_t mutex)
{
    if (mutex) xSemaphoreGive((SemaphoreHandle_t)mutex);
}

void plc_os_rmutex_lock(plc_os_mutex_t mutex)
{
    if (mutex) xSemaphoreTakeRecursive((SemaphoreHandle_t)mutex, portMAX_DELAY);
}

bool plc_os_rmutex_lock_for(plc_os_mutex_t mutex, uint32_t timeout_us)
{
    return !mutex || xSemaphoreTakeRecursive((SemaphoreHandle_t)mutex, us_to_ticks_ceil(timeout_us)) == pdTRUE;
}

void plc_os_rmutex_unlock(plc_os_mutex_t mutex)
{
    if (mutex) xSemaphoreGiveRecursive((SemaphoreHandle_t)mutex);
}

plc_os_ticks_t plc_os_ticks_now(void) { return (plc_os_ticks_t)xTaskGetTickCount(); }

uint32_t plc_os_tick_period_us(void) { return portTICK_PERIOD_MS * 1000U; }

void plc_os_yield_tick(void) { vTaskDelay(1); }

} // extern "C"
#endif

// ---------------------------------------------------------------------------
// STruC++'s lock for each shared global, on a toolchain without <mutex>
// (STRUCPP_PLATFORM_THREADS). The globals are made at static initialisation,
// before an RTOS object should be, so a lock starts empty and
// plc_os_platform_locks_ready() gives each its mutex before the first IEC task
// starts; until then only setup() runs. On a PLC_OS_SMALL_STACKS board every
// global shares one lock: its RTOS heap has no room for one each.
// ---------------------------------------------------------------------------
#if defined(STRUCPP_THREADED) && defined(STRUCPP_PLATFORM_THREADS)
struct PlatformLock {
    void *mutex;
    PlatformLock *next;
};
static PlatformLock *s_platform_locks = NULL;
static bool s_platform_locks_live = false;
static bool s_platform_locks_failed = false;

extern "C" void *strucpp_platform_mutex_create(void)
{
#if defined(PLC_OS_SMALL_STACKS)
    if (s_platform_locks) return s_platform_locks;   // the one every global shares
#endif
    PlatformLock *lock = (PlatformLock *)malloc(sizeof(PlatformLock));
    if (!lock) {
        s_platform_locks_failed = true;
        return NULL;
    }
    lock->mutex = s_platform_locks_live ? plc_os_rmutex_create() : NULL;
    if (s_platform_locks_live && !lock->mutex) s_platform_locks_failed = true;
    lock->next       = s_platform_locks;
    s_platform_locks = lock;
    return lock;
}

extern "C" void strucpp_platform_mutex_lock(void *handle)
{
    PlatformLock *lock = (PlatformLock *)handle;
    if (lock && lock->mutex) plc_os_rmutex_lock(lock->mutex);
}

extern "C" void strucpp_platform_mutex_unlock(void *handle)
{
    PlatformLock *lock = (PlatformLock *)handle;
    if (lock && lock->mutex) plc_os_rmutex_unlock(lock->mutex);
}

extern "C" bool strucpp_platform_mutex_try_lock(void *handle)
{
    PlatformLock *lock = (PlatformLock *)handle;
    return !lock || !lock->mutex || plc_os_rmutex_lock_for(lock->mutex, 0);
}

bool plc_os_platform_locks_ready(void)
{
    for (PlatformLock *lock = s_platform_locks; lock; lock = lock->next) {
        if (!lock->mutex) lock->mutex = plc_os_rmutex_create();
        if (!lock->mutex) s_platform_locks_failed = true;
    }
    s_platform_locks_live = true;
    return !s_platform_locks_failed;
}
#endif

// ---------------------------------------------------------------------------
// Cortex-M0/M0+ (an RP2040 under Mbed, the SAMD21, a Cortex-M0+ STM32) has no
// atomic read-modify-write instruction, so GCC calls these for
// `__atomic_add_fetch` and neither libgcc nor those cores provide them. Masking
// interrupts is enough, since each runs on one core; arduino-pico's SDK supplies
// its own for both cores.
// ---------------------------------------------------------------------------
#if defined(__ARM_ARCH_6M__) && \
    (defined(OPENPLC_RTOS_MBED_RTX) || defined(OPENPLC_RTOS_FREERTOS_SAMD) || defined(OPENPLC_RTOS_FREERTOS_STM32))
extern "C" unsigned int __atomic_fetch_add_4(volatile void *ptr, unsigned int value, int)
{
    const uint32_t key = irq_save();
    volatile unsigned int *p = (volatile unsigned int *)ptr;
    const unsigned int old = *p;
    *p = old + value;
    irq_restore(key);
    return old;
}

extern "C" unsigned int __atomic_add_fetch_4(volatile void *ptr, unsigned int value, int)
{
    const uint32_t key = irq_save();
    volatile unsigned int *p = (volatile unsigned int *)ptr;
    const unsigned int now = *p + value;
    *p = now;
    irq_restore(key);
    return now;
}
#endif

#endif // OPENPLC_RTOS
