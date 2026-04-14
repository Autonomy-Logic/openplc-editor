# Phase 7: Thread-Per-Task Model for Runtime v4

## Goal

Replace the single-threaded round-robin task execution in Runtime v4 with a thread-per-task
model. Each PLC task gets its own POSIX thread with SCHED_FIFO real-time priority matching the
task's declared priority. This is only for Runtime v4 (Linux); Arduino retains round-robin.

## Prerequisites

- Phase 6 (v4_compat.cpp with C-linkage interface)
- Runtime v4 codebase at `~/Documents/Code/openplc-runtime`

## Current Architecture

The runtime currently has a single PLC cycle thread (`plc_cycle_thread` in `plc_state_manager.c`):

```c
// Current: single thread runs everything
while (plc_state == PLC_STATE_RUNNING) {
    scan_cycle_time_start();
    plugin_mutex_take(&buffer_mutex);
    journal_apply_and_clear();
    plugin_driver_cycle_start(plugin_driver);
    ext_config_run__(tick__++);       // Runs ALL tasks sequentially
    ext_updateTime();
    plugin_driver_cycle_end(plugin_driver);
    plugin_mutex_give(&buffer_mutex);
    scan_cycle_time_end();
    sleep_until(&timer_start);
}
```

This works but has limitations:
- All tasks share the same cycle time (common_ticktime__, which is the GCD)
- Fast tasks are delayed by slow tasks (no preemption)
- No priority differentiation between tasks

## New Architecture

Each task gets its own thread:

```
Thread 0 (Task "fast", T#10ms, Priority 10):
  loop:
    mutex_take(buffer_mutex)
    run_task(0)  // calls program0.run()
    mutex_give(buffer_mutex)
    sleep_until(next_10ms)

Thread 1 (Task "slow", T#100ms, Priority 5):
  loop:
    mutex_take(buffer_mutex)
    run_task(1)  // calls program1.run()
    mutex_give(buffer_mutex)
    sleep_until(next_100ms)
```

## Step 7.1: New .so Symbols

**File to modify**: `src/backend/shared/utils/PLC/generate-v4-compat.ts` (from Phase 6)

Add new optional symbols to `v4_compat.cpp`:

```cpp
// =============================================================================
// Optional per-task interface (for thread-per-task runtime)
// =============================================================================

extern "C" size_t strucpp_get_task_count(void) {
    return TASK_COUNT;  // number of tasks in CONFIGURATION
}

extern "C" int64_t strucpp_get_task_interval_ns(size_t task_idx) {
    if (task_idx >= TASK_COUNT) return 0;
    static const int64_t intervals[] = {
        10000000LL,   // Task 0: T#10ms
        100000000LL,  // Task 1: T#100ms
    };
    return intervals[task_idx];
}

extern "C" int strucpp_get_task_priority(size_t task_idx) {
    if (task_idx >= TASK_COUNT) return 0;
    static const int priorities[] = {
        10,  // Task 0 priority
        5,   // Task 1 priority
    };
    return priorities[task_idx];
}

extern "C" void strucpp_run_task(size_t task_idx) {
    if (task_idx >= TASK_COUNT) return;
    task_programs[task_idx]->run();
}

// Signal that this .so supports per-task threading
extern "C" const uint32_t strucpp_capabilities = 0x0001;  // bit 0 = per-task
```

## Step 7.2: Runtime Per-Task Thread Spawning

**File to modify**: `openplc-runtime/core/src/plc_app/plc_state_manager.c`

### Symbol Resolution

Add new optional symbol resolution in `symbols_init()` (or a new function):

```c
// Optional STruC++ per-task symbols
static size_t (*ext_strucpp_get_task_count)(void) = NULL;
static int64_t (*ext_strucpp_get_task_interval_ns)(size_t) = NULL;
static int (*ext_strucpp_get_task_priority)(size_t) = NULL;
static void (*ext_strucpp_run_task)(size_t) = NULL;

void symbols_init_strucpp(PluginManager* pm) {
    ext_strucpp_get_task_count = plugin_manager_get_func(pm, ..., "strucpp_get_task_count");
    ext_strucpp_get_task_interval_ns = plugin_manager_get_func(pm, ..., "strucpp_get_task_interval_ns");
    ext_strucpp_get_task_priority = plugin_manager_get_func(pm, ..., "strucpp_get_task_priority");
    ext_strucpp_run_task = plugin_manager_get_func(pm, ..., "strucpp_run_task");
}

bool has_strucpp_per_task(void) {
    return ext_strucpp_get_task_count != NULL
        && ext_strucpp_get_task_interval_ns != NULL
        && ext_strucpp_get_task_priority != NULL
        && ext_strucpp_run_task != NULL;
}
```

### Thread Creation

In `load_plc_program()`, after symbol resolution:

```c
void load_plc_program(PluginManager* pm) {
    if (!plugin_manager_load(pm)) {
        log_error("Failed to load PLC program");
        return;
    }

    plc_state = PLC_STATE_INIT;

    // Standard initialization
    symbols_init(pm);
    symbols_init_strucpp(pm);  // Try to resolve optional symbols

    ext_config_init__();
    ext_glueVars();

    plugin_mutex_take(&buffer_mutex);
    image_tables_fill_null_pointers();
    plugin_mutex_give(&buffer_mutex);

    if (has_strucpp_per_task()) {
        // NEW: Per-task threading model
        size_t task_count = ext_strucpp_get_task_count();
        log_info("STruC++ per-task mode: %zu tasks", task_count);

        plc_task_threads = calloc(task_count, sizeof(pthread_t));
        plc_task_count = task_count;

        for (size_t i = 0; i < task_count; i++) {
            TaskThreadArgs* args = malloc(sizeof(TaskThreadArgs));
            args->task_idx = i;
            args->interval_ns = ext_strucpp_get_task_interval_ns(i);
            args->priority = ext_strucpp_get_task_priority(i);
            args->plugin_driver = plugin_driver;

            pthread_create(&plc_task_threads[i], NULL, plc_task_thread, args);
        }
    } else {
        // LEGACY: Single-thread model (MatIEC or single-task STruC++)
        pthread_create(&plc_thread, NULL, plc_cycle_thread, pm);
    }
}
```

### Per-Task Thread Function

```c
typedef struct {
    size_t task_idx;
    int64_t interval_ns;
    int priority;
    PluginDriver* plugin_driver;
} TaskThreadArgs;

static void* plc_task_thread(void* arg) {
    TaskThreadArgs* task = (TaskThreadArgs*)arg;

    // Record thread ID for crash handler
    log_info("Task %zu thread started (interval: %lld ns, priority: %d)",
             task->task_idx, task->interval_ns, task->priority);

    // Set real-time priority
    struct sched_param param;
    param.sched_priority = task->priority;
    if (pthread_setschedparam(pthread_self(), SCHED_FIFO, &param) != 0) {
        log_warn("Could not set SCHED_FIFO priority %d for task %zu",
                 task->priority, task->task_idx);
    }

    // Lock memory to prevent page faults
    lock_memory();

    // Install crash signal handlers (same as plc_cycle_thread)
    install_crash_handlers();

    // Initialize timing
    struct timespec next_wakeup;
    clock_gettime(CLOCK_MONOTONIC, &next_wakeup);

    uint32_t local_tick = 0;
    volatile int holding_mutex = 0;

    // Set jump point for crash recovery
    if (sigsetjmp(crash_jmp_buf, 1) != 0) {
        // Crash recovery
        if (holding_mutex) {
            holding_mutex = 0;
            plugin_mutex_give(&task->plugin_driver->buffer_mutex);
        }
        log_error("Task %zu crashed (signal %d), entering ERROR state",
                  task->task_idx, crash_sig);
        plc_state = PLC_STATE_ERROR;
        free(task);
        return NULL;
    }

    // Main execution loop
    while (plc_state == PLC_STATE_RUNNING) {
        // Acquire mutex (priority-inheriting)
        holding_mutex = 1;
        plugin_mutex_take(&task->plugin_driver->buffer_mutex);

        // Execute this task's program(s)
        ext_strucpp_run_task(task->task_idx);

        // Update time if this is the highest-priority (first) task
        if (task->task_idx == 0) {
            ext_updateTime();
            atomic_store(&plc_heartbeat, time(NULL));
        }

        // Release mutex
        plugin_mutex_give(&task->plugin_driver->buffer_mutex);
        holding_mutex = 0;

        // Sleep until next period
        next_wakeup.tv_nsec += task->interval_ns;
        while (next_wakeup.tv_nsec >= 1000000000LL) {
            next_wakeup.tv_nsec -= 1000000000LL;
            next_wakeup.tv_sec++;
        }
        clock_nanosleep(CLOCK_MONOTONIC, TIMER_ABSTIME, &next_wakeup, NULL);

        local_tick++;
    }

    log_info("Task %zu thread stopped after %u ticks", task->task_idx, local_tick);
    free(task);
    return NULL;
}
```

### Thread Cleanup on Stop

```c
void stop_plc_program(void) {
    plc_state = PLC_STATE_STOPPING;

    if (plc_task_count > 0) {
        // Per-task model: join all task threads
        for (size_t i = 0; i < plc_task_count; i++) {
            pthread_join(plc_task_threads[i], NULL);
        }
        free(plc_task_threads);
        plc_task_threads = NULL;
        plc_task_count = 0;
    } else {
        // Single-thread model: join the one thread
        pthread_join(plc_thread, NULL);
    }

    plc_state = PLC_STATE_STOPPED;
}
```

## Step 7.3: Plugin Integration

Plugins (`plugin_driver_cycle_start`, `plugin_driver_cycle_end`) currently run inside the
single PLC cycle thread. With per-task threads, we need to decide when plugins run:

**Option A** (recommended): Plugins run in the highest-priority task's thread only.
- `cycle_start` is called before the first task's `run()`
- `cycle_end` is called after the first task's `run()`
- Other tasks only acquire the mutex, run their program, and release

**Option B**: Plugins run in a separate dedicated thread.
- More complex, requires a third mutex coordination point

Going with Option A:

```c
// In plc_task_thread, when task->task_idx == 0:
plugin_mutex_take(&task->plugin_driver->buffer_mutex);

if (task->task_idx == 0) {
    journal_apply_and_clear();
    plugin_driver_cycle_start(task->plugin_driver);
}

ext_strucpp_run_task(task->task_idx);

if (task->task_idx == 0) {
    ext_updateTime();
    plugin_driver_cycle_end(task->plugin_driver);
    atomic_store(&plc_heartbeat, time(NULL));
}

plugin_mutex_give(&task->plugin_driver->buffer_mutex);
```

## Global Variable Synchronization

### The Problem

Different tasks may share global variables declared in `VAR_GLOBAL` of the CONFIGURATION.
With per-task threads, concurrent access to these variables must be synchronized.

### The Solution: buffer_mutex

The existing `buffer_mutex` (with `PTHREAD_PRIO_INHERIT`) already provides synchronization:

1. Each task thread acquires `buffer_mutex` before running its program
2. Tasks execute one at a time (mutex serializes execution)
3. Between executions, tasks sleep (no mutex held)

This means tasks don't truly run in parallel during their computation phase. The parallelism
comes from:
- **Different sleep periods**: A 10ms task wakes up 10x more often than a 100ms task
- **Independent timing**: Each task has its own clock, not tied to a GCD base tick
- **Priority scheduling**: SCHED_FIFO ensures the highest-priority waiting task runs first

For most PLC applications, task execution time is much smaller than the cycle period (e.g.,
1ms execution in a 10ms cycle). The mutex serialization adds negligible overhead.

### Future Optimization: Fine-Grained Locking

For applications where true parallel execution is needed:
1. Each global variable gets its own read-write lock
2. Tasks acquire read locks for variables they read, write locks for variables they write
3. Lock ordering prevents deadlocks

This is a significant optimization that can be added later without changing the .so interface.

## Design Notes

### SCHED_FIFO Priority Mapping

IEC 61131-3 TASK priority values are integers where higher = more important. Linux SCHED_FIFO
priorities are also integers where higher = more important (range 1-99). The mapping is direct:

```c
int linux_priority = task->priority;
if (linux_priority < 1) linux_priority = 1;
if (linux_priority > 99) linux_priority = 99;
```

### Watchdog Integration

Only the highest-priority task (task 0) updates the `plc_heartbeat` atomic variable. The
watchdog monitors this to detect PLC stalls. If any task thread crashes, the crash handler
sets `plc_state = PLC_STATE_ERROR`, causing all task threads to exit their loops.

### Backward Compatibility

The `has_strucpp_per_task()` check ensures:
- MatIEC .so files (no `strucpp_get_task_count` symbol): use single-thread model
- STruC++ single-task .so files: use single-thread model (1 task, no benefit from threading)
- STruC++ multi-task .so files: use per-task threading

The single-thread model remains the default and is fully preserved.

## Testing Strategy

1. **Dual-task test**: Two tasks at T#10ms and T#100ms
   - Verify both threads are created
   - Verify each runs at its configured interval (within 10% tolerance)
   - Verify no deadlock after 10,000 cycles

2. **Priority test**: High-priority task should preempt low-priority task's sleep
   - Create tasks with priorities 10 and 5
   - Verify SCHED_FIFO is set (check `/proc/[pid]/sched`)

3. **Global variable test**: Two tasks sharing a global variable
   - Task 1 writes a counter
   - Task 2 reads the counter
   - Verify no torn reads (counter is always a valid value)

4. **Crash recovery**: Introduce a deliberate SIGFPE in task 1
   - Verify task 1 thread catches the signal
   - Verify PLC transitions to ERROR state
   - Verify task 0 thread also stops

5. **Single-task fallback**: Upload a single-task program
   - Verify single-thread model is used (no per-task threads)

6. **MatIEC fallback**: Upload a MatIEC-compiled program
   - Verify single-thread model is used

## Files Created/Modified

| File | Action |
|------|--------|
| `src/backend/shared/utils/PLC/generate-v4-compat.ts` | Modified -- add per-task symbols |
| `openplc-runtime/core/src/plc_app/plc_state_manager.c` | Modified -- per-task thread spawning |
| `openplc-runtime/core/src/plc_app/plc_state_manager.h` | Modified -- new data structures |
| `openplc-runtime/core/src/plc_app/image_tables.c` | Modified -- resolve new symbols |
