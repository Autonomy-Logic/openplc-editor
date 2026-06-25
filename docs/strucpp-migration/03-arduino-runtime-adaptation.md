# Phase 3: Arduino Runtime Adaptation

## Goal

Create a static Arduino sketch that works with the STruC++ generated C++ files produced by
Phase 2. The sketch navigates STruC++ runtime structures dynamically -- it walks `locatedVars[]`
for I/O binding, walks the `Configuration` class for task discovery and scheduling, and computes
`common_ticktime__` from task intervals. The same sketch code works for every project.

After this phase, the full pipeline works end-to-end: `program.st` → `compile()` →
`generated.cpp` + `generated.hpp` → `arduino-cli` → firmware binary.

## Prerequisites

- Phase 1 complete (STruC++ dependency infrastructure)
- Phase 2 complete (compiler pipeline generates `generated.cpp` + `generated.hpp`)

## Key STruC++ Runtime Types

The Arduino sketch uses these types from `iec_std_lib.hpp` (all in `namespace strucpp`):

**`ProgramBase`** -- base class for all program instances:
```cpp
struct ProgramBase {
    virtual void run() = 0;
};
```

**`TaskInstance`** -- describes a task's scheduling and programs:
```cpp
struct TaskInstance {
    const char* name;
    int64_t interval_ns;        // Execution interval in nanoseconds
    int32_t priority;           // Higher = more important
    ProgramBase** programs;     // Array of program instances
    size_t program_count;
};
```

**`ResourceInstance`** -- describes a resource and its tasks:
```cpp
struct ResourceInstance {
    const char* name;
    const char* processor;
    TaskInstance* tasks;
    size_t task_count;
};
```

**`ConfigurationInstance`** -- base class for configuration (generated code inherits from this):
```cpp
struct ConfigurationInstance {
    virtual const char* get_name() const = 0;
    virtual ResourceInstance* get_resources() = 0;
    virtual size_t get_resource_count() const = 0;
};
```

**`LocatedVar`** (from `iec_located.hpp`) -- describes a located variable's I/O binding:
```cpp
struct LocatedVar {
    LocatedArea area;       // Input, Output, or Memory
    LocatedSize size;       // Bit, Byte, Word, DWord, or LWord
    uint16_t byte_index;
    uint8_t bit_index;
    uint8_t _reserved[3];
    void* pointer;          // Points to IECVar<T>::value_ via raw_ptr()
};
```

The generated code always names the configuration class `Configuration_Config0` (OpenPLC
always uses `Config0` as the configuration name -- this is not user-configurable).

## Step 3.1: Create New Arduino Sketch

**New file**: `resources/sources/Baremetal/Baremetal.ino`

This is a **static** sketch -- the same code for every project. It dynamically discovers
the project structure from STruC++ runtime types at `setup()` time.

### Sketch Architecture

```
setup():
  1. Configuration_Config0 constructed (static global)
  2. Walk locatedVars[] → bind to openplc.h buffer pointers
  3. Walk config.get_resources() → discover tasks, programs, intervals
  4. Compute GCD of all task intervals → common_ticktime__
  5. Compute per-task divisors for round-robin scheduling
  6. Init hardware (HAL) + Modbus (unchanged from current)

loop():
  1. Wait for scan cycle timer
  2. updateInputBuffers()           (HAL -- unchanged)
  3. For each task: if tick % divisor == 0, call program->run()
  4. updateOutputBuffers()          (HAL -- unchanged)
  5. updateTime()
  6. modbusTask() if time permits   (unchanged)
```

### Key Functions in the Sketch

#### I/O Binding (replaces `glueVars()`)

```cpp
void bindLocatedVars() {
    using namespace strucpp;
    for (uint32_t i = 0; i < locatedVarsCount; ++i) {
        LocatedVar& lv = locatedVars[i];
        if (!lv.pointer) continue;

        switch (lv.area) {
        case LocatedArea::Input:
            switch (lv.size) {
            case LocatedSize::Bit:
                bool_input[lv.byte_index][lv.bit_index] = (IEC_BOOL*)lv.pointer;
                break;
            case LocatedSize::Word:
                int_input[lv.byte_index] = (IEC_UINT*)lv.pointer;
                break;
            case LocatedSize::DWord:
                dint_input[lv.byte_index] = (IEC_UDINT*)lv.pointer;
                break;
            case LocatedSize::LWord:
                lint_input[lv.byte_index] = (IEC_ULINT*)lv.pointer;
                break;
            default: break;
            }
            break;
        case LocatedArea::Output:
            // symmetric to Input with bool_output, int_output, etc.
            break;
        case LocatedArea::Memory:
            // int_memory, dint_memory, lint_memory
            break;
        }
    }
}
```

#### Task Discovery and GCD Computation

```cpp
// Storage for discovered task scheduling info
static strucpp::ProgramBase** all_programs = nullptr;
static uint32_t* task_divisors = nullptr;
static size_t total_programs = 0;
unsigned long long common_ticktime__ = 20000000ULL; // default 20ms

uint64_t gcd(uint64_t a, uint64_t b) {
    while (b) { uint64_t t = b; b = a % b; a = t; }
    return a;
}

void discoverTasks(strucpp::ConfigurationInstance& config) {
    // First pass: count total programs and compute GCD
    uint64_t gcd_ns = 0;
    size_t prog_count = 0;

    auto* resources = config.get_resources();
    for (size_t r = 0; r < config.get_resource_count(); ++r) {
        for (size_t t = 0; t < resources[r].task_count; ++t) {
            auto& task = resources[r].tasks[t];
            prog_count += task.program_count;
            uint64_t interval = task.interval_ns > 0 ? task.interval_ns : 20000000ULL;
            gcd_ns = (gcd_ns == 0) ? interval : gcd(gcd_ns, interval);
        }
    }

    if (gcd_ns == 0) gcd_ns = 20000000ULL;
    common_ticktime__ = gcd_ns;

    // Second pass: build flat program array with divisors
    all_programs = new strucpp::ProgramBase*[prog_count];
    task_divisors = new uint32_t[prog_count];
    total_programs = prog_count;

    size_t idx = 0;
    for (size_t r = 0; r < config.get_resource_count(); ++r) {
        for (size_t t = 0; t < resources[r].task_count; ++t) {
            auto& task = resources[r].tasks[t];
            uint64_t interval = task.interval_ns > 0 ? task.interval_ns : gcd_ns;
            uint32_t divisor = (uint32_t)(interval / gcd_ns);
            for (size_t p = 0; p < task.program_count; ++p) {
                all_programs[idx] = task.programs[p];
                task_divisors[idx] = divisor;
                idx++;
            }
        }
    }
}
```

#### PLC Cycle Execution

```cpp
void plcCycleTask() {
    updateInputBuffers();
    // Run each program according to its task divisor
    for (size_t i = 0; i < total_programs; ++i) {
        if (task_divisors[i] == 0 || (__tick % task_divisors[i]) == 0) {
            all_programs[i]->run();
        }
    }
    __tick++;
    updateOutputBuffers();
    updateTime();
}
```

### Key Differences from the MatIEC-era Baremetal.ino

| Aspect | Old (MatIEC Baremetal.ino) | New (STruC++ Baremetal.ino) |
|--------|------------------------|--------------------------|
| Includes | `extern "C" { #include "openplc.h" }` | `#include "generated.hpp"` |
| Init | `config_init__()` + `glueVars()` | Static `Configuration_Config0` + `bindLocatedVars()` + `discoverTasks()` |
| PLC run | Single `config_run__(__tick++)` | Per-program `run()` with divisor check |
| Task scheduling | All tasks at same rate | GCD-based round-robin per task |
| Time | `common_ticktime__` from generated code | `common_ticktime__` computed at runtime |
| Modbus | Unchanged | Unchanged |
| HAL | Unchanged | Unchanged |

## Step 3.2: Clean Up openplc.h

The current `openplc.h` declares MatIEC-specific functions (`config_init__`, `config_run__`,
`glueVars`, `updateTime`, `common_ticktime__`). These are all removed since the sketch handles
everything directly through STruC++ runtime types.

What remains in `openplc.h`:
- IEC type definitions (`IEC_BOOL`, `IEC_INT`, etc.)
- Buffer pointer declarations (`bool_input`, `int_output`, etc.)
- Buffer size macros (`MAX_DIGITAL_INPUT`, etc.)
- HAL function declarations (`hardwareInit`, `updateInputBuffers`, `updateOutputBuffers`)

## Design Notes

### Why the Sketch is Fully Static

Every project produces the same C++ structures (`ConfigurationInstance`, `TaskInstance`,
`ProgramBase`, `LocatedVar`). The sketch navigates these structures with generic loops.
Nothing is project-specific except:
- The Configuration class name: always `Configuration_Config0` (hardcoded by OpenPLC)
- The `generated.hpp`/`generated.cpp` files: included, not generated by the sketch

### Why Keep openplc.h Buffer Arrays

The HAL files (`uno_leonardo_nano_micro_zero.cpp`, `esp32.cpp`, `mega_due.cpp`, etc.) use
`openplc.h` buffer pointer arrays: `bool_input[byte][bit]`, `int_input[index]`, etc.

Rewriting all HAL files for STruC++ types would be a massive effort with no benefit. The
sketch's `bindLocatedVars()` populates these same buffer pointers from STruC++ `LocatedVar`
descriptors. The HAL files see no difference.

### Memory Layout: IECVar<T>

Each variable is wrapped in `IECVar<T>`:
`IECVar<int16_t> { int16_t value_; bool forced_; int16_t forced_value_; }` = 5 bytes.

This is comparable to the old MatIEC `__IEC_INT_p` (5 bytes). No significant memory overhead.

### Dynamic Memory in discoverTasks()

The `discoverTasks()` function uses `new` to allocate the program pointer and divisor arrays.
This happens once at `setup()` time and the arrays live for the lifetime of the program. On
Arduino, this is acceptable since:
- It happens once (not in the scan loop)
- The total size is small (a few pointers per task)
- The memory is never freed (matches Arduino's typical pattern)

For boards with very tight memory (ATmega328P), the total overhead is ~8 bytes per program
instance (pointer + divisor).

## Step 3.3: Add `-std=gnu++17` to hals.json

**File to modify**: `resources/sources/boards/hals.json`

Add `"cxx_flags": ["-std=gnu++17", "-MMD", "-c"]` to all board entries. This is required
for arduino-cli to compile the STruC++ C++17 output.

(Deferred from Phase 2 since it's only needed once the sketch exists and arduino-cli
actually compiles the STruC++ output.)

## Testing Strategy

1. **End-to-end compile**: Simple ST project through the full pipeline
   - Phase 2 generates `generated.cpp` and `generated.hpp`
   - This phase's sketch + adapted `openplc.h` make `arduino-cli` succeed
   - Verify firmware binary is produced

2. **Simulator test**: Run on the ATmega2560 simulator
   - Verify scan cycle runs
   - Verify located variables are bound to I/O buffers

3. **Multi-task test**: Two tasks at T#20ms and T#40ms
   - Verify GCD computation: `common_ticktime__ = 20000000`
   - Verify divisors: `[1, 2]`
   - Verify task1 runs every cycle, task2 every other cycle

4. **HAL compatibility test**: Compile with each major HAL file
   - Verify no compilation errors with STruC++ C++17 code

5. **End-to-end code generation test**: Verify the full pipeline from `program.st` through
   STruC++ `compile()` to `generated.cpp`/`generated.hpp` in the build directory, followed
   by a successful `arduino-cli` compilation producing a firmware binary.
   (Deferred from Phase 2 -- code generation was validated via unit tests, but the full
   arduino-cli round-trip requires the sketch and adapted openplc.h from this phase.)

## Files Created/Modified

| File | Action |
|------|--------|
| `resources/sources/Baremetal/Baremetal.ino` | **New** -- static Arduino sketch |
| `resources/sources/arduino/openplc.h` | Modified -- remove MatIEC-specific declarations |
| `resources/sources/boards/hals.json` | Modified -- add `-std=gnu++17` to `cxx_flags` |

Note: Runtime headers come from `resources/strucpp/runtime/include/` (downloaded in Phase 1).
