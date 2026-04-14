# Phase 2: Arduino Runtime C++ Adaptation

## Goal

Create the Arduino-side C++ runtime files that bridge STruC++ generated code with the existing
HAL (Hardware Abstraction Layer) and Modbus infrastructure. The HAL files and Modbus slave
implementation remain unchanged -- only the glue layer between them and the PLC program changes.

## Prerequisites

- Phase 1 complete (STruC++ compiler wrapper producing C++ code and metadata)
- STruC++ runtime headers available for bundling

## Step 2.1: Bundle STruC++ Runtime Headers

**New directory**: `resources/sources/StrucppRuntime/`

Copy these header-only C++17 files from `strucpp/src/runtime/include/`:

```
iec_var.hpp         -- IECVar<T> template (forcing, raw_ptr)
iec_types.hpp       -- IEC type aliases (IEC_INT, IEC_BOOL, etc.)
iec_located.hpp     -- LocatedVar struct, LocatedArea/LocatedSize enums
iec_traits.hpp      -- Type trait helpers
iec_array.hpp       -- Array1D, Array2D, Array3D templates
iec_string.hpp      -- IECString<N> (stack-allocated, fixed-size)
iec_enum.hpp        -- Enum type support
iec_struct.hpp      -- Struct base helpers
iec_std_lib.hpp     -- IEC standard functions (ABS, MIN, MAX, etc.)
iec_time.hpp        -- TIME type operations
iec_date.hpp        -- DATE type operations
iec_tod.hpp         -- TIME_OF_DAY operations
iec_dt.hpp          -- DATE_AND_TIME operations
iec_char.hpp        -- CHAR/WCHAR types
iec_wstring.hpp     -- WSTRING type
iec_memory.hpp      -- Memory operation helpers
iec_retain.hpp      -- Retain variable support
iec_pointer.hpp     -- POINTER TO support
iec_ptr.hpp         -- REF_TO support
iec_subrange.hpp    -- Subrange type support
```

These are all **header-only** with no platform-specific code. They compile on any C++17
toolchain including Arduino AVR GCC 7.3+.

**Maintenance**: When STruC++ updates its runtime headers, this directory must be synced.
Consider a build script or git submodule for automation.

## Step 2.2: Create New Arduino Sketch

**New file**: `resources/sources/StrucppBaremetal/StrucppBaremetal.ino`

This sketch mirrors the structure of the existing `Baremetal.ino` (351 lines) but is adapted
for STruC++ generated C++ code. The key differences are:

1. Includes `generated.hpp` and `generated_glue.hpp` instead of MatIEC C headers
2. Calls STruC++ init/run functions instead of `config_init__()` / `config_run__(tick)`
3. Adds `strucpp_restore_forced_inputs()` after HAL input reads
4. Uses GCD-based multi-task scheduler

### Complete Sketch Structure

```cpp
// StrucppBaremetal.ino

// --- STruC++ generated files (per-project) ---
#include "generated.hpp"         // Program classes, Configuration, LocatedVar[]
#include "generated_glue.hpp"    // I/O binding, scheduler, debug arrays, MD5

// --- OpenPLC static files (unchanged from current runtime) ---
#include "openplc.h"             // I/O buffer declarations
#include "debug.h"               // Debug function declarations (updated for v2)
#include "ModbusSlave.h"         // Modbus communication

// --- Timing ---
extern unsigned long long common_ticktime__;  // Defined in generated_glue.hpp
static unsigned long scan_cycle;
static unsigned long last_run;
static uint32_t __tick = 0;
static bool first_cycle = true;

// =============================================================================
// SETUP
// =============================================================================
void setup() {
    // 1. Initialize STruC++ Configuration (creates program instances)
    strucpp_config_init();

    // 2. Bind located variables to I/O buffer pointers
    strucpp_bind_located_vars();

    // 3. Initialize hardware (HAL -- unchanged)
    hardwareInit();

    // 4. Configure Modbus (unchanged from current Baremetal.ino)
    #ifdef MODBUS_ENABLED
        #if defined(MBSERIAL_IFACE)
            mbconfig_serial_iface();
        #elif defined(MBTCP_IFACE)
            mbconfig_ethernet_iface();
        #endif
        init_mbregs();
        mapEmptyBuffers();
    #endif

    // 5. Set scan cycle from GCD of task intervals
    setupCycleDelay(common_ticktime__);
}

// =============================================================================
// MAP EMPTY BUFFERS (for Modbus -- identical to current Baremetal.ino)
// =============================================================================
void mapEmptyBuffers() {
    // Exact same implementation as current Baremetal.ino lines 135-191
    // Maps unmapped I/O to Modbus registers
    // No changes needed -- uses same openplc.h buffer pointers
}

// =============================================================================
// MODBUS TASK (identical to current Baremetal.ino)
// =============================================================================
void modbusTask() {
    // Exact same implementation as current Baremetal.ino lines 193-289
    // Syncs OpenPLC buffers <-> Modbus registers
    // No changes needed
}

// =============================================================================
// PLC CYCLE TASK
// =============================================================================
void plcCycleTask() {
    // 1. Read hardware inputs into buffers (HAL -- unchanged)
    updateInputBuffers();

    // 2. Restore forced values for input variables
    //    (HAL writes directly to raw_ptr(), overwriting forced values)
    strucpp_restore_forced_inputs();

    // 3. Execute PLC logic via GCD-based multi-task scheduler
    strucpp_config_run(__tick++);

    // 4. Write buffers to hardware outputs (HAL -- unchanged)
    updateOutputBuffers();

    // 5. Update time (same logic as current)
    updateTime();
}

// =============================================================================
// SCHEDULER (same structure as current, calls new task function)
// =============================================================================
void scheduler() {
    plcCycleTask();

    #ifdef USE_ARDUINO_SKETCH
        sketch_loop();
    #endif

    #ifdef MODBUS_ENABLED
        modbusTask();
    #endif

    if (first_cycle) {
        first_cycle = false;
        scan_cycle = (unsigned long)(common_ticktime__ / 1000);
        last_run = micros();
    }
}

// =============================================================================
// MAIN LOOP (identical timing logic to current Baremetal.ino)
// =============================================================================
void loop() {
    unsigned long now = micros();
    if ((now - last_run) >= scan_cycle) {
        last_run = now;
        scheduler();
    }

    #ifdef MODBUS_ENABLED
        // Run extra Modbus cycles between PLC scans if time permits
        if ((micros() - last_run) < (scan_cycle - 10000)) {
            modbusTask();
        }
    #endif

    #ifdef SIMULATOR_MODE
        asm("sleep");
    #endif
}
```

### Key Differences from Current Baremetal.ino

| Aspect | Current (Baremetal.ino) | New (StrucppBaremetal.ino) |
|--------|------------------------|--------------------------|
| Includes | `extern "C" { #include "openplc.h" }` | `#include "generated.hpp"` + `"generated_glue.hpp"` |
| Init | `config_init__()` + `glueVars()` | `strucpp_config_init()` + `strucpp_bind_located_vars()` |
| PLC run | `config_run__(__tick++)` | `strucpp_config_run(__tick++)` |
| Forced vars | Not handled at HAL level | `strucpp_restore_forced_inputs()` after `updateInputBuffers()` |
| Time | `updateTime()` from glueVars.c | `updateTime()` from generated_glue.hpp |
| Modbus | Unchanged | Unchanged |
| HAL | Unchanged | Unchanged |

## Step 2.3: Arduino Glue Code Generator

**New file**: `src/backend/shared/utils/PLC/generate-arduino-glue.ts`

This TypeScript module generates `generated_glue.hpp` -- a per-project C++ header that contains
all the "glue" between STruC++ generated code and the Arduino runtime.

### Public API

```typescript
export interface ArduinoGlueInput {
  /** Configuration class name from STruC++ output (e.g., "Config0") */
  configurationName: string
  /** Task scheduling metadata from STruCppResult */
  taskIntervals: TaskInterval[]
  /** Variable descriptors per program from STruCppResult */
  variableDescriptors: ProgramVarDescriptor[]
  /** MD5 hash of the program.st source */
  md5Hash: string
  /** Board memory class (determines buffer sizes) */
  boardMemoryClass: 'avr-small' | 'avr-large' | 'arm' | 'esp32'
}

/**
 * Generates the content of generated_glue.hpp.
 * This is a pure function -- no file I/O, fully shared between Electron and web.
 */
export function generateArduinoGlue(input: ArduinoGlueInput): string
```

### Generated File Structure

The output `generated_glue.hpp` contains these sections:

#### Section 1: Configuration Singleton

```cpp
#pragma once
#include "generated.hpp"
#include "openplc.h"

using namespace strucpp;

// --- Global Configuration instance ---
static Configuration_Config0 g_config;

void strucpp_config_init() {
    // Configuration constructor initializes all program instances
    // Located variable pointers are set in program constructors
}
```

#### Section 2: I/O Buffer Binding

```cpp
// --- Bind LocatedVar descriptors to OpenPLC I/O buffers ---
void strucpp_bind_located_vars() {
    for (uint32_t i = 0; i < locatedVarsCount; ++i) {
        LocatedVar& lv = locatedVars[i];
        if (!lv.pointer) continue;

        switch (lv.area) {
        case LocatedArea::Input:
            switch (lv.size) {
            case LocatedSize::Bit:
                bool_input[lv.byte_index][lv.bit_index] = (IEC_BOOL*)lv.pointer;
                break;
            case LocatedSize::Byte:
                // byte_input is only available on non-Arduino targets
                // For Arduino, bytes are typically accessed via word-sized buffers
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
            }
            break;

        case LocatedArea::Output:
            switch (lv.size) {
            case LocatedSize::Bit:
                bool_output[lv.byte_index][lv.bit_index] = (IEC_BOOL*)lv.pointer;
                break;
            case LocatedSize::Word:
                int_output[lv.byte_index] = (IEC_UINT*)lv.pointer;
                break;
            case LocatedSize::DWord:
                dint_output[lv.byte_index] = (IEC_UDINT*)lv.pointer;
                break;
            case LocatedSize::LWord:
                lint_output[lv.byte_index] = (IEC_ULINT*)lv.pointer;
                break;
            }
            break;

        case LocatedArea::Memory:
            switch (lv.size) {
            case LocatedSize::Word:
                int_memory[lv.byte_index] = (IEC_UINT*)lv.pointer;
                break;
            case LocatedSize::DWord:
                dint_memory[lv.byte_index] = (IEC_UDINT*)lv.pointer;
                break;
            case LocatedSize::LWord:
                lint_memory[lv.byte_index] = (IEC_ULINT*)lv.pointer;
                break;
            }
            break;
        }
    }
}
```

This function replaces the old `glueVars()` generated by xml2st. Instead of hardcoded
pointer assignments, it iterates the LocatedVar descriptor array that STruC++ generates.

**How it works**: STruC++ generates a `locatedVars[]` array where each entry describes a
located variable's area (I/Q/M), size (X/B/W/D/L), byte index, and bit index. The program
constructor sets `locatedVars[i].pointer = variable.raw_ptr()`. This function then connects
those pointers to the OpenPLC buffer arrays.

#### Section 3: GCD-Based Task Scheduler

```cpp
// --- Multi-task round-robin scheduler ---
// Base tick = GCD of all task intervals
// Each task runs when: tick % divisor == 0

unsigned long long common_ticktime__ = 20000000ULL; // GCD in nanoseconds

static ProgramBase* task_programs[] = {
    &g_config.instance0,
    &g_config.instance1,
    // ... one per program instance
};

static const uint32_t task_divisors[] = {
    1,  // instance0: 20ms / 20ms = every tick
    2,  // instance1: 40ms / 20ms = every 2nd tick
    // ...
};

static const size_t TASK_COUNT = 2; // number of tasks

void strucpp_config_run(unsigned long tick) {
    for (size_t i = 0; i < TASK_COUNT; ++i) {
        if (task_divisors[i] == 0 || (tick % task_divisors[i]) == 0) {
            task_programs[i]->run();
        }
    }
}
```

**GCD computation example**: For tasks at T#20ms and T#50ms, GCD = 10ms.
Divisors: [2, 5]. Task0 runs at ticks 0,2,4,6,... Task1 at 0,5,10,...

For a single-task project, this simplifies to calling `run()` every tick.

#### Section 4: Forced Input Restoration

```cpp
// --- Restore forced input values after HAL reads ---
// HAL writes directly to IECVar::value_ via raw_ptr(), overwriting forced values.
// This function restores value_ from forced_value_ for forced input variables.

void strucpp_restore_forced_inputs() {
    // Generated per-project for each located INPUT variable:
    if (g_config.instance0.sensor.is_forced())
        *(bool*)locatedVars[1].pointer = g_config.instance0.sensor.get_forced_value();
    // ... repeat for each located input variable
}
```

**Why this is needed**: When a variable is forced (for debugging), `IECVar::force(v)` sets
both `forced_value_` and `value_` to `v`. The PLC program reads via `get()` which returns
`forced_value_`. But the HAL's `updateInputBuffers()` writes hardware readings directly to
`value_` via `raw_ptr()`. After HAL reads, `value_` contains the hardware reading (not the
forced value). Since `get()` returns `forced_value_`, PLC logic is correct. But any code
reading via `raw_ptr()` (including the debug system's value display) would see the hardware
value. This function ensures `value_` matches the forced state after HAL reads.

For OUTPUT variables, this is not needed: `force()` sets `value_`, and `set()` is a no-op
when forced, so `value_` stays at the forced value through PLC cycles. The HAL reads from
`raw_ptr()` and writes the forced value to hardware.

#### Section 5: Time Update and MD5

```cpp
// --- Time management ---
extern IEC_TIME __CURRENT_TIME;

void updateTime() {
    __CURRENT_TIME = __CURRENT_TIME + (int64_t)common_ticktime__;
}

// --- Program MD5 hash ---
const char plc_program_md5[] = "a1b2c3d4e5f6...";
```

#### Section 6: Debug Arrays (detailed in Phase 3)

The debug pointer arrays are also generated in this file. See Phase 3 for details.

## Step 2.4: C++17 Compilation Flag

**File to modify**: `resources/sources/boards/hals.json`

For every board entry, ensure CXX flags include `-std=gnu++17`:

```json
{
  "Arduino Uno": {
    "compiler": "arduino-cli",
    "core": "arduino:avr",
    "platform": "arduino:avr:uno",
    "source": "uno_leonardo_nano_micro_zero.cpp",
    "cxx_flags": ["-std=gnu++17", "-MMD", "-c"],
    "compiler_backend": "strucpp",
    ...
  }
}
```

The `"compiler_backend": "strucpp"` field (default: `"matiec"` if absent) controls which
compilation pipeline the editor uses for this board.

**C++17 support by platform**:

| Platform | GCC Version | C++17 Support |
|----------|-------------|---------------|
| Arduino AVR | 7.3+ | Yes (bundled with Arduino IDE 2.x) |
| ESP32 | 8.4+ (ESP-IDF) | Yes |
| STM32 | 10+ (STM32duino) | Yes |
| RP2040 | 10+ (Arduino Mbed) | Yes |
| SAMD | 7.2+ | Yes |

## Design Notes

### Why Keep openplc.h Buffer Arrays

The HAL files (`uno_leonardo_nano_micro_zero.cpp`, `esp32.cpp`, `mega_due.cpp`, etc.) use
`openplc.h` buffer pointer arrays: `bool_input[byte][bit]`, `int_input[index]`, etc.

Rewriting all HAL files for STruC++ types would be a massive effort with no benefit. Instead,
the glue layer populates these same buffer pointers from STruC++ LocatedVar descriptors.
The HAL files see no difference.

### Memory Layout: IECVar vs MatIEC __IEC_type_p

| MatIEC | STruC++ |
|--------|---------|
| `__IEC_INT_p { int16_t value; int16_t fvalue; uint8_t flags; }` = 5 bytes | `IECVar<int16_t> { int16_t value_; bool forced_; int16_t forced_value_; }` = 5 bytes |
| `__IEC_BOOL_p { uint8_t value; uint8_t fvalue; uint8_t flags; }` = 3 bytes | `IECVar<bool> { bool value_; bool forced_; bool forced_value_; }` = 3 bytes |

Memory overhead is essentially the same.

### Board Memory Classes

The buffer sizes in `openplc.h` vary by chip:

| Class | Boards | Digital I/O | Analog I/O | Memory |
|-------|--------|-------------|------------|--------|
| avr-small | ATmega328P, ATmega168, ATmega32U4 | 8 DIN, 32 DOUT | 6 AIN, 32 AOUT | 0 |
| avr-large | ATmega2560, all others | 56 DIN/DOUT | 32 AIN/AOUT | 20 W/DW/LW |

The glue generator uses this to validate located variable addresses don't exceed buffer limits.

## Testing Strategy

1. **Minimal project test**: Single program, one digital output (%QX0.0)
   - Generate glue code
   - Verify `bool_output[0][0]` is bound to the variable's `raw_ptr()`
   - Compile with arduino-cli for Simulator target

2. **Multi-task test**: Two tasks at T#20ms and T#40ms
   - Verify `common_ticktime__ = 20000000`
   - Verify `task_divisors = {1, 2}`
   - Verify `TASK_COUNT = 2`

3. **Forced input test**: Located input variable (%IX0.0)
   - Force the variable, call `updateInputBuffers()` (simulated HAL write)
   - Call `strucpp_restore_forced_inputs()`
   - Verify `raw_ptr()` returns the forced value

4. **HAL compatibility test**: Compile with each HAL file
   - Verify no compilation errors
   - Verify HAL functions (`hardwareInit`, `updateInputBuffers`, `updateOutputBuffers`)
     are resolved correctly

## Files Created/Modified

| File | Action |
|------|--------|
| `resources/sources/StrucppRuntime/*.hpp` | **New** -- STruC++ runtime headers |
| `resources/sources/StrucppBaremetal/StrucppBaremetal.ino` | **New** -- Arduino sketch |
| `src/backend/shared/utils/PLC/generate-arduino-glue.ts` | **New** -- Glue code generator |
| `resources/sources/boards/hals.json` | Modified -- add cxx_flags, compiler_backend |
