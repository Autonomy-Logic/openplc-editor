// arduino_runtime_glue.cpp — Arduino-side runtime shim. Equivalent role to
// runtime_v4_entry.cpp for the OpenPLC v4 .so build, but compiled into the
// Arduino library at src/ instead of into a daemon-loaded .so.
//
// arduino-cli does NOT auto-prepend <Arduino.h> to library .cpp files
// (only to the .ino), so every strucpp library body stays in a translation
// unit that never sees Arduino.h's macro pollution.
//
// External linkage requirements:
//   - `g_config` is referenced by name (with type) from generated_debug.cpp
//     via `extern ::strucpp::Configuration_CONFIG0 g_config;`. The symbol
//     name and type must match here.
//   - The buffer arrays (bool_input, int_input, etc.) are defined in the
//     sketch's .ino and declared extern in openplc.h. We only read/write
//     them here; the storage lives in the sketch's TU.

#include "arduino_runtime_glue.h"
#include "openplc.h"
#include "generated.hpp"
#include "debug_dispatch.hpp"

// ---------------------------------------------------------------------------
// Runtime fault hook
// ---------------------------------------------------------------------------
// Weak default for strucpp::iec_runtime_fault (declared in iec_fault.hpp).
// On MCU firmware (compiled -fno-exceptions) the runtime calls this instead
// of throwing on an unrecoverable fault (null deref, array OOB, bad located
// address). Default behaviour: halt. A VPP HAL may provide a STRONG override
// to signal the fault its own way — blink a status LED, sound an alarm,
// reboot, etc. Kept free of <Arduino.h> so this TU stays macro-clean.
__attribute__((weak)) void strucpp::iec_runtime_fault(strucpp::IecFault /*reason*/,
                                                       const char* /*context*/) noexcept {
    for (;;) {
    }
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------
strucpp::Configuration_CONFIG0 g_config;

static strucpp::ProgramBase** all_programs = nullptr;
static uint32_t*               task_divisors  = nullptr;
static size_t                  total_programs = 0;

unsigned long long base_tick_ns = 20000000ULL;
uint32_t           scan_counter = 0;

// ---------------------------------------------------------------------------
// GCD utility — used by discoverTasks for the base-tick computation
// ---------------------------------------------------------------------------
static uint64_t gcd(uint64_t a, uint64_t b)
{
    while (b) {
        uint64_t t = b;
        b = a % b;
        a = t;
    }
    return a;
}

// ---------------------------------------------------------------------------
// I/O binding: walk locatedVars[] and bind to openplc.h buffer pointers
// ---------------------------------------------------------------------------
void runtime_bind_located_vars()
{
    using namespace strucpp;
    for (uint32_t i = 0; i < locatedVarsCount; ++i) {
        LocatedVar& lv = locatedVars[i];
        if (!lv.pointer) continue;

        switch (lv.area) {
        case LocatedArea::Input:
            switch (lv.size) {
            case LocatedSize::Bit:
                bool_input[lv.byte_index][lv.bit_index] = (::IEC_BOOL*)lv.pointer;
                break;
            case LocatedSize::Word:
                int_input[lv.byte_index] = (::IEC_UINT*)lv.pointer;
                break;
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
            case LocatedSize::DWord:
                // OpenPLC convention: %ID<n> is REAL.  Drivers that
                // deliver engineering-unit readings (volts, mA, °C, …)
                // bind here instead of int_input.  Declaring DINT AT
                // %ID<n> is not supported on arduino-cli; the
                // variable's bytes would still land in this slot but
                // the runtime treats them as a float.
                if (lv.byte_index < MAX_REAL_INPUT) {
                    real_input[lv.byte_index] = (::IEC_REAL*)lv.pointer;
                }
                break;
            case LocatedSize::LWord:
                // lint_input not available on arduino-cli targets.
                break;
#endif
            default: break;
            }
            break;

        case LocatedArea::Output:
            switch (lv.size) {
            case LocatedSize::Bit:
                bool_output[lv.byte_index][lv.bit_index] = (::IEC_BOOL*)lv.pointer;
                break;
            case LocatedSize::Word:
                int_output[lv.byte_index] = (::IEC_UINT*)lv.pointer;
                break;
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
            case LocatedSize::DWord:
                // OpenPLC convention: %QD<n> is REAL.  Drivers that
                // accept engineering-unit setpoints (volts on an
                // analog DAC, °C, …) bind here instead of int_output.
                if (lv.byte_index < MAX_REAL_OUTPUT) {
                    real_output[lv.byte_index] = (::IEC_REAL*)lv.pointer;
                }
                break;
            case LocatedSize::LWord:
                // lint_output not available on arduino-cli targets.
                break;
#endif
            default: break;
            }
            break;

        case LocatedArea::Memory:
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
            switch (lv.size) {
            case LocatedSize::Word:
                int_memory[lv.byte_index] = (::IEC_UINT*)lv.pointer;
                break;
            case LocatedSize::DWord:
                dint_memory[lv.byte_index] = (::IEC_UDINT*)lv.pointer;
                break;
            case LocatedSize::LWord:
                lint_memory[lv.byte_index] = (::IEC_ULINT*)lv.pointer;
                break;
            default: break;
            }
#endif
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Task discovery: walk Configuration → Resource → Task and flatten
// programs into all_programs[] with per-program divisors derived from the
// GCD of task intervals.
// ---------------------------------------------------------------------------
void runtime_discover_tasks()
{
    uint64_t gcd_ns    = 0;
    size_t   prog_count = 0;

    auto* resources = g_config.get_resources();
    for (size_t r = 0; r < g_config.get_resource_count(); ++r) {
        for (size_t t = 0; t < resources[r].task_count; ++t) {
            auto& task = resources[r].tasks[t];
            prog_count += task.program_count;
            uint64_t interval = task.interval_ns > 0 ? task.interval_ns : 20000000ULL;
            gcd_ns = (gcd_ns == 0) ? interval : gcd(gcd_ns, interval);
        }
    }

    if (gcd_ns == 0) gcd_ns = 20000000ULL;
    base_tick_ns = gcd_ns;

    all_programs   = new strucpp::ProgramBase*[prog_count];
    task_divisors  = new uint32_t[prog_count];
    total_programs = prog_count;

    size_t idx = 0;
    for (size_t r = 0; r < g_config.get_resource_count(); ++r) {
        for (size_t t = 0; t < resources[r].task_count; ++t) {
            auto&    task    = resources[r].tasks[t];
            uint64_t interval = task.interval_ns > 0 ? task.interval_ns : gcd_ns;
            uint32_t divisor  = (uint32_t)(interval / gcd_ns);
            for (size_t p = 0; p < task.program_count; ++p) {
                all_programs[idx]  = task.programs[p];
                task_divisors[idx] = divisor;
                ++idx;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// One scan cycle: copy inputs → run scheduled programs → copy outputs →
// advance IEC TIME() so TON/TOF/TP can progress.
// ---------------------------------------------------------------------------
void runtime_plc_cycle()
{
    updateInputBuffers();

    for (size_t i = 0; i < total_programs; ++i) {
        if (task_divisors[i] == 0 || (scan_counter % task_divisors[i]) == 0) {
            all_programs[i]->run();
        }
    }
    ++scan_counter;

    updateOutputBuffers();

    strucpp::__CURRENT_TIME_NS += (int64_t)base_tick_ns;
}

// ---------------------------------------------------------------------------
// Debug dispatch shims — C-linkage wrappers around strucpp::debug::handle_*.
// Declared in arduino_runtime_glue.h; ModbusSlave.cpp calls these by name so
// it never has to include the strucpp template-heavy debug_dispatch.hpp.
// ---------------------------------------------------------------------------

extern "C" uint8_t openplc_debug_array_count()
{
    return strucpp::debug::handle_array_count();
}

extern "C" uint16_t openplc_debug_elem_count(uint8_t arr)
{
    return strucpp::debug::handle_elem_count(arr);
}

extern "C" uint16_t openplc_debug_size(uint8_t arr, uint16_t elem)
{
    return strucpp::debug::handle_size(arr, elem);
}

extern "C" uint16_t openplc_debug_read(uint8_t arr, uint16_t elem, uint8_t* dest)
{
    return strucpp::debug::handle_read(arr, elem, dest);
}

extern "C" uint8_t openplc_debug_set(uint8_t arr, uint16_t elem, uint8_t forcing,
                                     const uint8_t* bytes, uint16_t len)
{
    return strucpp::debug::handle_set(arr, elem, forcing != 0, bytes, len);
}
