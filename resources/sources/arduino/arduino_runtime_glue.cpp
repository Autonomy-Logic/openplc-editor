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

// Placement new, used by runtime_reinit_program() to re-run the program's
// initializers over storage that already exists. Available on every target the
// editor builds for, AVR included (the bundled avr-libstdcpp ships <new>, and
// the strucpp headers above already pull it in transitively via <algorithm>).
// Note this is the PLACEMENT form only -- it allocates nothing.
#include <new>
// std::is_trivially_destructible, for the diagnostic static_assert below.
#include <type_traits>

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
// Run/stop state. See the contract comment in arduino_runtime_glue.h.
//
// `software_stop` is the latch set by runtime_request_plc_state(); `plc_state`
// is derived from it plus the switch every cycle, so it is never written from
// anywhere but runtime_plc_cycle() / runtime_init_plc_state().
// ---------------------------------------------------------------------------
static uint8_t plc_state      = PLC_STATE_RUNNING;
static uint8_t switch_position = PLC_SWITCH_RUN;
static uint8_t last_switch     = PLC_SWITCH_RUN;
static bool    software_stop   = false;

// Weak default: boards with no physical mode switch always read RUN, so the
// gate collapses to "software request only" and the boot state is RUNNING --
// identical to the behaviour before this interface existed. A VPP HAL
// provides a strong extern "C" override.
extern "C" __attribute__((weak)) uint8_t hardwareStateSwitch(void)
{
    return PLC_SWITCH_RUN;
}

extern "C" uint8_t runtime_get_plc_state(void)
{
    return plc_state;
}

extern "C" uint8_t runtime_get_switch_position(void)
{
    return switch_position;
}

extern "C" uint8_t runtime_request_plc_state(uint8_t desired_state)
{
    if (desired_state == PLC_STATE_RUNNING) {
        // Hardware is authoritative: refuse rather than queue, so the caller
        // can tell the user to flip the switch instead of silently waiting.
        if (hardwareStateSwitch() == PLC_SWITCH_STOP) return PLC_CTRL_REFUSED_SWITCH_STOP;
        software_stop = false;
        return PLC_CTRL_OK;
    }
    if (desired_state == PLC_STATE_STOPPED) {
        software_stop = true;
        return PLC_CTRL_OK;
    }
    return PLC_CTRL_INVALID;
}

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
// Force re-imposition for located variables.
//
// On bare-metal the image table aliases the IECVar's storage: a located var's
// image slot pointer (bool_output[..], int_input[..], …) IS its raw_ptr()
// (&value_). The program body can't defeat a force — IECVar::set() is a no-op
// while forced_ — but DIRECT writes through the image pointer bypass set():
//   - updateInputBuffers() writes *bool_input[..] = digitalRead(...)
//   - the Modbus reverse-copy writes *bool_output[..] = COILS[..]
// Either clobbers a forced located variable's storage. (This is the bug the
// open PR #719 chases by DELETING the digital-output reverse-copy — which also
// breaks Modbus coil mirroring into mapped outputs. We instead KEEP the
// reverse-copy and re-impose the force right after each direct-write batch, so
// both forcing AND Modbus mirroring work.)
//
// re-impose = restore value_ from forced_value_ for every forced located var.
// locatedVars[i].pointer is the IECVar's raw_ptr() = &value_, and IECVar is
// standard-layout with value_ as its first member, so the slot pointer is
// pointer-interconvertible with the IECVar itself. The cast is by located
// SIZE only; signed/unsigned/REAL of the same width share IECVar layout and
// the restore is a width-correct value copy, so a single unsigned alias per
// width is correct for all of them.
template <typename T>
static inline void reimpose_if_forced(void* p)
{
    if (!p) return;
    auto* v = reinterpret_cast<strucpp::IECVar<T>*>(p);
    if (v->is_forced()) {
        *v->raw_ptr() = v->get_forced_value();
    }
}

void runtime_apply_located_forces()
{
    using namespace strucpp;
    for (uint32_t i = 0; i < locatedVarsCount; ++i) {
        LocatedVar& lv = locatedVars[i];
        if (!lv.pointer) continue;
        switch (lv.size) {
        case LocatedSize::Bit:   reimpose_if_forced<BOOL_t>(lv.pointer);  break;
        case LocatedSize::Byte:  reimpose_if_forced<BYTE_t>(lv.pointer);  break;
        case LocatedSize::Word:  reimpose_if_forced<WORD_t>(lv.pointer);  break;
        case LocatedSize::DWord: reimpose_if_forced<DWORD_t>(lv.pointer); break;
        case LocatedSize::LWord: reimpose_if_forced<LWORD_t>(lv.pointer); break;
        default: break;
        }
    }
}

// ---------------------------------------------------------------------------
// De-energise the output image.
//
// Called every cycle while stopped, immediately before updateOutputBuffers()
// pushes the image to hardware. Two consequences worth keeping in mind:
//
//   - A Modbus client writing coils between cycles cannot energise a physical
//     output while stopped: its write lands in the image and is zeroed here
//     before the HAL ever sees it.
//   - Memory areas (int_memory / dint_memory / lint_memory) are deliberately
//     NOT cleared. They are not physical outputs.
//
// The image slots alias the located variables' IECVar storage, so this also
// zeroes the program's own %QX / %QW / %QD variables. That is intended: a
// stopped PLC holds no output state.
// ---------------------------------------------------------------------------
static void runtime_zero_output_image()
{
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; ++i) {
        if (bool_output[i / 8][i % 8]) *bool_output[i / 8][i % 8] = 0;
    }
    for (int i = 0; i < MAX_ANALOG_OUTPUT; ++i) {
        if (int_output[i]) *int_output[i] = 0;
    }
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
    for (int i = 0; i < MAX_REAL_OUTPUT; ++i) {
        if (real_output[i]) *real_output[i] = 0.0f;
    }
#endif
}

// ---------------------------------------------------------------------------
// Cold-stop the program: re-run every IEC initial value so the next start
// begins at cycle 1 rather than resuming mid-flight.
//
// NO DYNAMIC ALLOCATION. g_config is a file-scope object with static storage
// duration (.bss/.data), and placement new constructs into that existing
// storage — it calls neither malloc nor operator new(size_t). Everything the
// generated Configuration holds is by value and fixed size, and nothing in
// the strucpp runtime allocates (IECVar is three value members; IEC_STRING is
// a fixed char array).
//
// Every pointer into g_config survives, because placement new reuses the same
// storage with the same layout: locatedVars[i].pointer, the image-table slots,
// the ProgramBase* entries cached in all_programs[] and in the configuration's
// own task_programs_storage[], and the flash-resident Entry tables in
// generated_debug.cpp that hold raw void* into g_config members.
//
// runtime_discover_tasks() is deliberately NOT re-run: it new[]-allocates
// all_programs / task_divisors, so calling it twice would leak. The tables it
// built stay correct.
//
// Two documented consequences: debugger forces are cleared (force state lives
// inside each IECVar), and a program using the explicit IEC NEW operator must
// DELETE before stopping or it leaks across restarts — nothing frees those
// allocations automatically, at re-init or otherwise.
// ---------------------------------------------------------------------------
static void runtime_reinit_program()
{
    // Destroy then re-construct in place. The destructor call matters:
    // Configuration_CONFIG0 derives from strucpp::ConfigurationInstance, which
    // declares `virtual ~ConfigurationInstance() = default` (iec_std_lib.hpp),
    // so the type is NOT trivially destructible even though it owns nothing.
    // Pairing the destructor with the placement new is correct either way --
    // for a defaulted virtual destructor it compiles to nothing, and if a
    // future strucpp change adds a genuinely owning member it runs that
    // member's cleanup instead of leaking it. Neither call allocates.
    g_config.~Configuration_CONFIG0();
    new (&g_config) strucpp::Configuration_CONFIG0();

    runtime_zero_output_image();
    runtime_bind_located_vars();   // idempotent, allocation-free
    scan_counter = 0;
}

// ---------------------------------------------------------------------------
// Establish the initial state. Called once from setup(), after hardwareInit()
// so the HAL's switch pin is already configured.
// ---------------------------------------------------------------------------
void runtime_init_plc_state()
{
    switch_position = hardwareStateSwitch();
    last_switch     = switch_position;
    software_stop   = false;
    plc_state = (switch_position == PLC_SWITCH_STOP) ? PLC_STATE_STOPPED : PLC_STATE_RUNNING;
}

// ---------------------------------------------------------------------------
// One scan cycle: resolve run/stop → copy inputs → run scheduled programs →
// copy outputs → advance IEC TIME() so TON/TOF/TP can progress.
//
// While stopped the loop keeps cycling: inputs are still refreshed (so the
// debugger and Modbus clients see live field data during commissioning),
// outputs stay de-energised, updateOutputBuffers() is still called (so a HAL
// driving a status LED from it stays correct), and IEC time is frozen.
// ---------------------------------------------------------------------------
void runtime_plc_cycle()
{
    // 1. Resolve the state from the mode switch and the software latch.
    const uint8_t sw = hardwareStateSwitch();
    // A physical flip to RUN always puts the PLC in RUN — clearing a software
    // stop, so the switch is never overridden by a stale editor command.
    if (sw == PLC_SWITCH_RUN && last_switch == PLC_SWITCH_STOP) software_stop = false;
    last_switch     = sw;
    switch_position = sw;

    const uint8_t new_state =
        (sw == PLC_SWITCH_STOP || software_stop) ? PLC_STATE_STOPPED : PLC_STATE_RUNNING;

    // Entering STOP is a cold stop: zero the outputs and re-initialise the
    // program exactly once, on the transition.
    if (new_state == PLC_STATE_STOPPED && plc_state != PLC_STATE_STOPPED) {
        runtime_reinit_program();
    }
    plc_state = new_state;

    // 2. Inputs, in both states.
    updateInputBuffers();
    // HAL just wrote raw input storage directly — re-impose any forced input.
    runtime_apply_located_forces();

    if (plc_state == PLC_STATE_RUNNING) {
        for (size_t i = 0; i < total_programs; ++i) {
            if (task_divisors[i] == 0 || (scan_counter % task_divisors[i]) == 0) {
                all_programs[i]->run();
            }
        }
        ++scan_counter;
    } else {
        // Re-zero every stopped cycle, not just on the transition: a Modbus
        // client may have written coils into the image since the last cycle.
        runtime_zero_output_image();
    }

    // 3. Outputs, in both states — zeros while stopped.
    updateOutputBuffers();

    // 4. IEC time advances only while running, so TON/TOF/TP resume where
    //    they left off instead of jumping by the stop duration.
    if (plc_state == PLC_STATE_RUNNING) {
        strucpp::__CURRENT_TIME_NS += (int64_t)base_tick_ns;
    }
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
