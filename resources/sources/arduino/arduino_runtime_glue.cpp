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
#include "iec_retain.hpp"
#include "openplc_retain.h"
#include "opcua_types.h"
// RTOS mode (OPENPLC_RTOS). This file never sees defines.h, so the switch has
// a header of its own; 0 unless the editor built this firmware in RTOS mode.
#include "rtos_config.h"
#if OPENPLC_RTOS
#include "plc_os.h"
#include <string.h>

#ifndef OPENPLC_RTOS_COMMS_WAIT_US
// How long a service waits for a task's scan before answering "busy".
#define OPENPLC_RTOS_COMMS_WAIT_US 100000UL
#endif

#ifndef OPENPLC_RTOS_COMMS_GRACE_US
// A request touching several tasks' variables waits the full time only for the
// first; each of the others then gets this long, so the first is not held off
// its next scan.
#define OPENPLC_RTOS_COMMS_GRACE_US 2000UL
#endif
#endif

#if OPENPLC_RTOS && defined(STRUCPP_THREADED)
// STruC++'s lock for each global, by index, in a release that generates them;
// weak, so an older one leaves these null and the callers do without.
extern "C" bool    strucpp_global_try_lock(uint32_t g) __attribute__((weak));
extern "C" void    strucpp_global_unlock(uint32_t g) __attribute__((weak));
extern "C" int32_t strucpp_located_global_index(uint32_t k) __attribute__((weak));
extern "C" int32_t strucpp_debug_global_index(uint8_t arr, uint16_t elem) __attribute__((weak));

// The global a debug leaf belongs to, or -1.
static int32_t leaf_global(uint8_t arr, uint16_t elem)
{
    return (strucpp_debug_global_index && strucpp_global_try_lock) ? strucpp_debug_global_index(arr, elem) : -1;
}

// Global g's lock, waiting up to `wait_us` for a task to let it go. A service
// polls rather than blocks, so a task inside a long call of a global block
// costs it at most that wait.
static bool global_lock_for(int32_t g, uint32_t wait_us)
{
    if (g < 0) return false;
    const int64_t until = plc_os_now_us() + (int64_t)wait_us;
    while (!strucpp_global_try_lock((uint32_t)g)) {
        if (plc_os_now_us() >= until) return false;
        plc_os_yield_tick();
    }
    return true;
}

static void global_unlock(int32_t g)
{
    if (g >= 0) strucpp_global_unlock((uint32_t)g);
}
#endif

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

// Weak default: a board with no resident firmware bootloader cannot honour the
// Modbus reboot-to-bootloader command (FC 0x4C), so this is a no-op. A HAL whose
// device has one provides a strong extern "C" override (see openplc.h).
extern "C" __attribute__((weak)) void hardwareRebootToBootloader(void)
{
}

// Weak defaults: a board with no programming lock is never locked, so FC 0x4C
// is never refused and the prompt is never needed. A HAL whose device has a
// lock (the LOGO! panel) provides strong extern "C" overrides -- see openplc.h.
extern "C" __attribute__((weak)) uint8_t hardwareProgrammingLocked(void)
{
    return 0;
}

extern "C" __attribute__((weak)) void hardwarePromptUnlock(void)
{
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
#if OPENPLC_RTOS
    // Called from a service task, which must not call the HAL: the switch
    // position is the one the dispatcher read last, and the latch is published
    // for its next base tick.
    if (desired_state == PLC_STATE_RUNNING) {
        if (__atomic_load_n(&switch_position, __ATOMIC_ACQUIRE) == PLC_SWITCH_STOP)
            return PLC_CTRL_REFUSED_SWITCH_STOP;
        __atomic_store_n(&software_stop, false, __ATOMIC_RELEASE);
        return PLC_CTRL_OK;
    }
    if (desired_state == PLC_STATE_STOPPED) {
        __atomic_store_n(&software_stop, true, __ATOMIC_RELEASE);
        return PLC_CTRL_OK;
    }
    return PLC_CTRL_INVALID;
#else
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
#endif
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

#if OPENPLC_RTOS
static void runtime_rtos_bind_image();
static void runtime_rtos_seed_image();
#endif

// ---------------------------------------------------------------------------
// I/O binding: walk locatedVars[] and bind to openplc.h buffer pointers
// ---------------------------------------------------------------------------
void runtime_bind_located_vars()
{
#if OPENPLC_RTOS
    // RTOS mode: the slots address the runtime's process image instead of the
    // variables, and the scan copies between the two. See runtime_rtos_*.
    runtime_rtos_bind_image();
    return;
#endif
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
    // The placement-new above re-ran every declared initialiser, wiping the
    // retained values with it. Restore them, or entering STOP would silently
    // become a cold start — the transition users hit most often.
    runtime_retain_load();
    scan_counter = 0;
}

// ---------------------------------------------------------------------------
// Retain variables.
//
// The runtime MARSHALS and the platform STORES. `strucpp::retain` turns the
// retained leaves into a blob and back; `openplc_retain_*` puts those bytes
// somewhere that survives power loss. Neither knows anything about the other's
// half, which is what lets one board keep values in FRAM and the next in an
// EEPROM it may only write every ten seconds.
//
// The buffer is a file-scope array, sized once at start. Not a stack local: it
// is written from the scan path, and a few hundred bytes of stack per cycle is
// not affordable on a 2 KB-SRAM part. Not malloc'd either — the firmware
// allocates nothing after setup.
// ---------------------------------------------------------------------------

// The retain buffer belongs to the sketch, which sizes it from the program
// (OPLC_RETAIN_BLOB_SIZE in defines.h) and hands it to runtime_retain_init().
// So it is exactly as large as this program's blob — no fixed cap to outgrow —
// and a program that retains nothing allocates nothing. It is static storage,
// not heap: the scan cycle packs into it.
static uint8_t *retain_buffer     = nullptr;
static uint16_t retain_capacity   = 0;
static uint16_t retain_blob_len   = 0;   // 0 = nothing retained, or unusable
static bool     retain_available  = false;

// This program's identity, handed to the driver on every read for a driver
// that records it (the layout check decides whether stored values fit; see
// openplc_retain.h). Supplied by
// the sketch from PROGRAM_MD5 rather than read from defines.h here: defines.h
// has no include guard and must reach a translation unit through exactly one
// path (modbus_config.h), which this file is deliberately not on.
static const char *retain_program_md5 = nullptr;

static uint16_t retain_read_leaf(uint8_t arr, uint16_t elem, uint8_t* dest) {
#if OPENPLC_RTOS && defined(STRUCPP_THREADED)
    // Packed on the dispatcher, which never waits: a global a task holds this
    // moment is packed as it stands.
    const int32_t g = leaf_global(arr, elem);
    const bool held = global_lock_for(g, 0);
    const uint16_t n = strucpp::debug::handle_read(arr, elem, dest);
    if (held) global_unlock(g);
    return n;
#else
    return strucpp::debug::handle_read(arr, elem, dest);
#endif
}

// A PLAIN write, never a force. Restoring a retained value must not pin it: the
// program has to be able to move it on the very next scan, and an operator's
// force has to stay authoritative over whatever was stored.
static uint8_t retain_write_leaf(uint8_t arr, uint16_t elem, const uint8_t* bytes, uint16_t len) {
#if OPENPLC_RTOS && defined(STRUCPP_THREADED)
    // Restored with every task parked; a service may hold the global briefly.
    const int32_t g = leaf_global(arr, elem);
    const bool held = global_lock_for(g, OPENPLC_RTOS_COMMS_GRACE_US);
    const uint8_t status = strucpp::debug::handle_write(arr, elem, bytes, len);
    if (held) global_unlock(g);
    return status;
#else
    return strucpp::debug::handle_write(arr, elem, bytes, len);
#endif
}

static uint16_t retain_size_leaf(uint8_t arr, uint16_t elem) {
    return strucpp::debug::handle_size(arr, elem);
}

// ---------------------------------------------------------------------------
// Decide once, at start, what THIS RUNTIME can do about retention: does the
// program retain anything, and does the blob fit the buffer this firmware
// allocated for it. Both are facts about the runtime and the program, not about
// the board's storage — whether the platform can actually keep the bytes is the
// driver's answer, and it gives it by returning UNSUPPORTED from read().
// ---------------------------------------------------------------------------
void runtime_retain_init(const char *program_md5, uint8_t *buffer, uint16_t capacity)
{
    retain_available    = false;
    retain_blob_len     = 0;
    retain_program_md5  = program_md5;
    retain_buffer       = buffer;
    retain_capacity     = buffer ? capacity : 0;

    const size_t needed = strucpp::retain::blob_size(retain_size_leaf);
    if (needed == 0) return;           // the program retains nothing
    // The sketch sized the buffer from this same program, so this only fails
    // for firmware built without the editor's defines.h — where degrading to
    // NON_RETAIN still beats overrunning.
    if (needed > retain_capacity) return;

    retain_blob_len  = (uint16_t)needed;
    retain_available = true;
}

// ---------------------------------------------------------------------------
// Restore. Call after the IEC variables exist and before the first scan — on
// the transition into RUN, and after any re-initialisation, because that
// re-runs every declared initialiser and would otherwise make a STOP behave as
// a cold start. Idempotent by design, so calling it at all three is fine.
//
// The driver offers what it holds; an empty store answers NO_DATA. Anything
// the runtime cannot trust (bad magic, wrong format, failed crc, a layout from
// a different declaration) leaves every variable at its initial value. That is
// the correct outcome: a machine starting from its declared defaults is
// recoverable, one starting from plausible-looking garbage is not.
//
// UNSUPPORTED switches retention off for the rest of the run. A board with no
// backend should not pay to pack a blob 50 times a second that nothing stores,
// and the driver's own answer is the only honest way to learn that — the
// runtime no longer asks a capacity question up front.
// ---------------------------------------------------------------------------
void runtime_retain_load()
{
    if (!retain_available) return;

    uint16_t got = 0;
    const openplc_retain_status_t rc = openplc_retain_read(
        retain_program_md5, OPLC_RETAIN_PROGRAM_ID_LEN, retain_buffer, retain_blob_len, &got);

    if (rc == OPLC_RETAIN_UNSUPPORTED) {
        retain_available = false;
        return;
    }
    if (rc != OPLC_RETAIN_OK || got == 0) return;

    strucpp::retain::unpack(retain_buffer, got, retain_write_leaf, retain_size_leaf);
#if OPENPLC_RTOS
    // A located variable that was just restored must reach its image cell, or
    // the next copy-in would put the pre-restore value straight back.
    runtime_rtos_seed_image();
#endif
}

// ---------------------------------------------------------------------------
// Save. Called once per scan cycle, unconditionally, WHILE RUNNING.
//
// No dirty check and no rate limit here on purpose: whether these bytes are
// worth committing, and how often, is the platform's decision, and it is the
// only layer that knows what its storage costs. See openplc_retain.h.
//
// Running only, so the two runtimes agree: on the Linux daemon a STOP unloads
// the program outright and there is no scan to save from, and a firmware that
// kept writing an unchanging blob while the machine sat stopped would spend a
// board's flash budget on nothing.
// ---------------------------------------------------------------------------
void runtime_retain_save()
{
    if (!retain_available) return;

    const size_t n = strucpp::retain::pack(
        retain_buffer, retain_capacity, retain_read_leaf, retain_size_leaf);
    if (n == 0) return;

    openplc_retain_write(retain_buffer, (uint16_t)n);
}

// ---------------------------------------------------------------------------
// Commit anything the driver is still holding. Called on the transition into
// STOP, after the last scan and before the program is re-initialised.
//
// A hint, not the durability mechanism — write() is what protects against a
// power cut, and a power cut does not call this. What it buys is that a CLEAN
// stop loses nothing on a driver that buffers.
// ---------------------------------------------------------------------------
void runtime_retain_flush()
{
    if (!retain_available) return;
    openplc_retain_flush();
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
    //
    // The flush goes FIRST, and the order is load-bearing:
    // runtime_reinit_program() re-runs every declared initialiser, so a flush
    // after it would ask the driver to commit the initial values over the ones
    // the program actually stopped with.
    if (new_state == PLC_STATE_STOPPED && plc_state != PLC_STATE_STOPPED) {
        runtime_retain_flush();
        runtime_reinit_program();
    }

    // Entering RUN restores the retained values, matching where the Linux
    // daemon reloads them (it does it as part of loading the program). Nothing
    // normally changes them while stopped, so this is usually a no-op.
    // Idempotent, so calling it on every RUN edge is safe.
    if (new_state == PLC_STATE_RUNNING && plc_state != PLC_STATE_RUNNING) {
        runtime_retain_load();
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
#if defined(STRUCPP_THREADED) && defined(STRUCPP_PLATFORM_THREADS)
        // Compiled, never reached: in RTOS mode each worker keeps its own time.
        *strucpp::strucpp_platform_current_time_slot() += (int64_t)base_tick_ns;
#else
        strucpp::__CURRENT_TIME_NS += (int64_t)base_tick_ns;
#endif
    }

    // 5. Hand the retained values to the platform. Every cycle while RUNNING —
    //    a value that changed in the last scan before power loss is exactly the
    //    one worth keeping. Whether this is actually committed to storage now is
    //    the driver's call; the default is a no-op.
    //
    //    Not while stopped: the Linux daemon unloads the program on a STOP and
    //    has no scan to save from, so saving here would be the one place the two
    //    runtimes disagreed — and it would spend a board's flash budget
    //    rewriting an unchanging blob for as long as the machine sits idle. The
    //    values the program stopped with are already stored by the last RUNNING
    //    cycle, and the flush on the STOP transition commits them.
    if (plc_state == PLC_STATE_RUNNING) {
        runtime_retain_save();
    }
}

#if OPENPLC_RTOS
// ===========================================================================
// RTOS mode
//
// A dispatcher releases each IEC task on the base tick (skipping a release
// while the previous one still runs) and moves the I/O; each task runs on a
// worker thread of its own, the services on tasks of their own
// (Baremetal/plc_rtos.cpp).
//
// Process image: the slot pointers (bool_input[], int_output[], ...) address
// cells here, not the variables. A worker copies its located variables in at
// scan start and copies out only the outputs it changed, so a protocol write
// to an output the scan left alone survives. Forced values are pinned both ways.
//
// Lock order: scan locks (by worker index), then the image lock, then a located
// global's own lock; the network and bus locks (plc_rtos.h) last, taking
// nothing while one is held. Services hold scan locks only for memory work,
// never across a socket or UART.
//
// One worker per IEC task needs STRUCPP_THREADED; without it every task runs
// on one worker, by divisor, in the single loop's order.
// ===========================================================================


// The period of an IEC task with INTERVAL 0.
#define RTOS_DEFAULT_INTERVAL_NS 20000000ULL

#define RTOS_NO_OWNER 0xFFu

static plc_os_mutex_t s_image_lock = nullptr;

extern "C" void runtime_rtos_init(void)
{
    if (!s_image_lock) s_image_lock = plc_os_mutex_create();
    if (!s_image_lock) runtime_rtos_fault();
}

// RTOS mode could not be set up (a task or a lock could not be created): the
// PLC stays in ERROR, releases no task and holds its outputs off, rather than
// running with a task missing.
extern "C" void runtime_rtos_fault(void)
{
    __atomic_store_n(&plc_state, (uint8_t)PLC_STATE_ERROR, __ATOMIC_RELEASE);
}

extern "C" void runtime_rtos_image_lock(void)   { plc_os_mutex_lock(s_image_lock); }
extern "C" void runtime_rtos_image_unlock(void) { plc_os_mutex_unlock(s_image_lock); }

// ---- Workers -----------------------------------------------------------------

struct RtosWorker {
    const char*            name;
    int32_t                priority;          // IEC PRIORITY (0 is highest)
    uint32_t               release_divisor;   // released every this many base ticks
    strucpp::ProgramBase** programs;
    const uint32_t*        program_divisors;  // per program, in base ticks; null = every release
    uint64_t*              program_next;      // per program, the grid tick it is next due at
    size_t                 program_count;
    plc_os_mutex_t         scan_lock;
    uint32_t               scan_started_us;   // low 32 bits of plc_os_now_us(): no 64-bit atomics on Cortex-M
    bool                   scan_active;
#ifdef STRUCPP_PLATFORM_THREADS
    plc_os_task_t          thread;            // the worker's thread, set by its first cycle
    int64_t                time_ns;           // its IEC time
#endif
};

static RtosWorker* s_workers      = nullptr;
static uint32_t    s_worker_count = 0;

#if defined(STRUCPP_THREADED) && defined(STRUCPP_PLATFORM_THREADS)
// IEC time per thread on a toolchain without thread_local: each worker's own
// slot, found by the calling thread; every other thread shares one spare slot.
static int64_t s_time_ns_other = 0;

extern "C" int64_t *strucpp_platform_current_time_slot(void)
{
    const plc_os_task_t self = plc_os_task_self();
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        if (__atomic_load_n(&s_workers[w].thread, __ATOMIC_RELAXED) == self) return &s_workers[w].time_ns;
    }
    return &s_time_ns_other;
}
#endif

extern "C" uint32_t    runtime_rtos_worker_count(void) { return s_worker_count; }
extern "C" const char* runtime_rtos_worker_name(uint32_t w) { return s_workers[w].name; }
extern "C" int32_t     runtime_rtos_worker_priority(uint32_t w) { return s_workers[w].priority; }
extern "C" uint32_t    runtime_rtos_worker_divisor(uint32_t w) { return s_workers[w].release_divisor; }

// How long worker `w` has been in the scan it is in; 0 between scans.
// Wrap-safe: a difference of the low 32 bits, good for 71 minutes.
extern "C" uint32_t runtime_rtos_worker_busy_us(uint32_t w)
{
    const RtosWorker& k = s_workers[w];
    if (!__atomic_load_n(&k.scan_active, __ATOMIC_ACQUIRE)) return 0;
    return (uint32_t)plc_os_now_us() - __atomic_load_n(&k.scan_started_us, __ATOMIC_ACQUIRE);
}

// A task mid-scan for longer than twice its period (at least 20 ms): waiting on
// the network in a block, or stuck. Whoever wants its lock then does without it
// rather than wait, so one stalled task cannot hold up the others' service.
static bool worker_stalled(uint32_t w)
{
    const uint32_t busy  = runtime_rtos_worker_busy_us(w);
    const uint64_t limit = (base_tick_ns / 1000ULL) * s_workers[w].release_divisor * 2;
    return busy > (limit > 20000 ? limit : 20000);
}

// ---- The process image -------------------------------------------------------

static ::IEC_BOOL  s_img_bool_in[MAX_DIGITAL_INPUT];
static ::IEC_BOOL  s_img_bool_out[MAX_DIGITAL_OUTPUT];
static ::IEC_UINT  s_img_int_in[MAX_ANALOG_INPUT];
static ::IEC_UINT  s_img_int_out[MAX_ANALOG_OUTPUT];
static ::IEC_REAL  s_img_real_in[MAX_REAL_INPUT];
static ::IEC_REAL  s_img_real_out[MAX_REAL_OUTPUT];
static ::IEC_UINT  s_img_int_mem[MAX_MEMORY_WORD];
static ::IEC_UDINT s_img_dint_mem[MAX_MEMORY_DWORD];
static ::IEC_ULINT s_img_lint_mem[MAX_MEMORY_LWORD];

// One located variable and the image cell its slot addresses.
struct ImageBinding {
    void*    var;       // the IECVar's raw_ptr() (&value_), pointer-interconvertible with it
    void*    cell;
    uint32_t lv_index;  // its entry in locatedVars[], for ownership
    uint8_t  size;      // strucpp::LocatedSize
    bool     output;    // %Q and %M are copied out; %I only in
    uint8_t  owner;     // the worker that copies it, or RTOS_NO_OWNER (a located global)
    bool     global;    // a located CONFIGURATION global, which has a lock of its own
    int32_t  global_index;  // that global's index for STruC++'s lock hooks, or -1 without them
    uint64_t last;      // the value last synced between variable and cell, for change detection
};

static ImageBinding* s_bindings      = nullptr;
static uint32_t      s_binding_count = 0;

#ifdef STRUCPP_THREADED
// Emitted by STruC++ beside locatedVars[]: which located variables are
// CONFIGURATION globals, by address.
extern "C" void* const* strucpp_get_located_globals(void);
extern "C" uint32_t strucpp_get_located_global_count(void);
#endif

// Which worker copies each binding: the one running the program whose slice of
// locatedVars[] holds it; a single worker owns them all. A located CONFIGURATION
// global belongs to no program: the dispatcher copies it every frame under the
// global's own lock, which every task takes to use it.
static void runtime_rtos_assign_owners()
{
    for (uint32_t b = 0; b < s_binding_count; ++b) {
        s_bindings[b].owner        = (s_worker_count == 1) ? 0 : RTOS_NO_OWNER;
        s_bindings[b].global       = false;
        s_bindings[b].global_index = -1;
    }
    if (s_worker_count <= 1) return;
#ifdef STRUCPP_THREADED
    void* const*   globals      = strucpp_get_located_globals();
    const uint32_t global_count = strucpp_get_located_global_count();
    for (uint32_t b = 0; b < s_binding_count; ++b) {
        for (uint32_t g = 0; g < global_count; ++g) {
            if (globals[g] != s_bindings[b].var) continue;
            s_bindings[b].global = true;
            if (strucpp_located_global_index && strucpp_global_try_lock)
                s_bindings[b].global_index = strucpp_located_global_index(g);
        }
    }
#endif
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        for (size_t p = 0; p < s_workers[w].program_count; ++p) {
            uint32_t off = 0, cnt = 0;
            s_workers[w].programs[p]->located_range(&off, &cnt);
            for (uint32_t b = 0; b < s_binding_count; ++b) {
                if (s_bindings[b].lv_index >= off && s_bindings[b].lv_index < off + cnt) s_bindings[b].owner = (uint8_t)w;
            }
        }
    }
}

// Bind every located variable's slot to its image cell. Called at start-up and
// after each re-initialisation: allocates once, idempotent. A variable outside
// the board's image stays unbound.
static void runtime_rtos_bind_image()
{
    using namespace strucpp;
    if (!s_bindings && locatedVarsCount > 0) s_bindings = new ImageBinding[locatedVarsCount];
    s_binding_count = 0;

    for (uint32_t i = 0; i < locatedVarsCount; ++i) {
        LocatedVar& lv = locatedVars[i];
        if (!lv.pointer) continue;

        void* cell   = nullptr;
        bool  output = false;
        const uint32_t bit = (uint32_t)lv.byte_index * 8u + lv.bit_index;

        switch (lv.area) {
        case LocatedArea::Input:
            if (lv.size == LocatedSize::Bit && lv.bit_index < 8 && bit < MAX_DIGITAL_INPUT) {
                cell = &s_img_bool_in[bit];
                bool_input[lv.byte_index][lv.bit_index] = &s_img_bool_in[bit];
            } else if (lv.size == LocatedSize::Word && lv.byte_index < MAX_ANALOG_INPUT) {
                cell = &s_img_int_in[lv.byte_index];
                int_input[lv.byte_index] = &s_img_int_in[lv.byte_index];
            } else if (lv.size == LocatedSize::DWord && lv.byte_index < MAX_REAL_INPUT) {
                cell = &s_img_real_in[lv.byte_index];
                real_input[lv.byte_index] = &s_img_real_in[lv.byte_index];
            }
            break;

        case LocatedArea::Output:
            output = true;
            if (lv.size == LocatedSize::Bit && lv.bit_index < 8 && bit < MAX_DIGITAL_OUTPUT) {
                cell = &s_img_bool_out[bit];
                bool_output[lv.byte_index][lv.bit_index] = &s_img_bool_out[bit];
            } else if (lv.size == LocatedSize::Word && lv.byte_index < MAX_ANALOG_OUTPUT) {
                cell = &s_img_int_out[lv.byte_index];
                int_output[lv.byte_index] = &s_img_int_out[lv.byte_index];
            } else if (lv.size == LocatedSize::DWord && lv.byte_index < MAX_REAL_OUTPUT) {
                cell = &s_img_real_out[lv.byte_index];
                real_output[lv.byte_index] = &s_img_real_out[lv.byte_index];
            }
            break;

        case LocatedArea::Memory:
            output = true;
            if (lv.size == LocatedSize::Word && lv.byte_index < MAX_MEMORY_WORD) {
                cell = &s_img_int_mem[lv.byte_index];
                int_memory[lv.byte_index] = &s_img_int_mem[lv.byte_index];
            } else if (lv.size == LocatedSize::DWord && lv.byte_index < MAX_MEMORY_DWORD) {
                cell = &s_img_dint_mem[lv.byte_index];
                dint_memory[lv.byte_index] = &s_img_dint_mem[lv.byte_index];
            } else if (lv.size == LocatedSize::LWord && lv.byte_index < MAX_MEMORY_LWORD) {
                cell = &s_img_lint_mem[lv.byte_index];
                lint_memory[lv.byte_index] = &s_img_lint_mem[lv.byte_index];
            }
            break;
        }

        if (cell) {
            s_bindings[s_binding_count++] =
                ImageBinding{lv.pointer, cell, i, (uint8_t)lv.size, output, RTOS_NO_OWNER, false, -1, 0};
        }
    }

    if (s_workers) runtime_rtos_assign_owners();
    runtime_rtos_seed_image();
}

// Width-correct raw copies. Signed, unsigned and REAL of one width share the
// IECVar layout (see reimpose_if_forced), so one unsigned type per width serves.
template <typename T>
static inline void rtos_seed(ImageBinding& b)
{
    auto* v = reinterpret_cast<strucpp::IECVar<T>*>(b.var);
    const T value = v->is_forced() ? v->get_forced_value() : *v->raw_ptr();
    memcpy(b.cell, &value, sizeof(T));
    b.last = 0;
    memcpy(&b.last, &value, sizeof(T));
}

template <typename T>
static inline void rtos_copy_in(ImageBinding& b)
{
    auto* v = reinterpret_cast<strucpp::IECVar<T>*>(b.var);
    T value;
    if (v->is_forced()) {
        // Pinned both ways: the program keeps the forced value, and the image
        // shows it to the HAL and the protocols.
        value = v->get_forced_value();
        memcpy(b.cell, &value, sizeof(T));
    } else {
        memcpy(&value, b.cell, sizeof(T));
    }
    *v->raw_ptr() = value;
    b.last = 0;
    memcpy(&b.last, &value, sizeof(T));
}

template <typename T>
static inline void rtos_copy_out(ImageBinding& b)
{
    auto* v = reinterpret_cast<strucpp::IECVar<T>*>(b.var);
    const bool forced = v->is_forced();
    const T value = forced ? v->get_forced_value() : *v->raw_ptr();
    uint64_t bits = 0;
    memcpy(&bits, &value, sizeof(T));
    // Only what the program changed: an unchanged output leaves whatever a
    // protocol wrote to the cell during the scan in place. Once out, the two
    // agree again, so a later copy does not send the same change twice over a
    // protocol write that came in between.
    if (forced || bits != b.last) {
        memcpy(b.cell, &value, sizeof(T));
        b.last = bits;
    }
}

// A forced variable's cell shows its forced value, whatever wrote the cell
// since (the HAL on input, a protocol on output).
template <typename T>
static inline void rtos_pin_forced(ImageBinding& b)
{
#ifdef STRUCPP_THREADED
    // A global's force is read under its own lock, when that is free this moment.
    if (b.global_index >= 0 && !global_lock_for(b.global_index, 0)) return;
#endif
    auto* v = reinterpret_cast<strucpp::IECVar<T>*>(b.var);
    if (v->is_forced()) {
        const T value = v->get_forced_value();
        memcpy(b.cell, &value, sizeof(T));
    }
#ifdef STRUCPP_THREADED
    global_unlock(b.global_index);
#endif
}

// A located global, both ways, under the global's own lock: what a task wrote
// since the last sync goes out, then the cell (the HAL's input, a protocol's
// write) comes in. With STruC++'s lock hooks the dispatcher only tries the
// lock, and a global a task holds this moment syncs on the next frame. Without
// them a scalar's located pointer is its GlobalVar (the IECVar is its first
// member); the editor then builds a located ARRAY global with one worker.
template <typename T>
static inline void rtos_sync_global(ImageBinding& b, bool in)
{
#ifdef STRUCPP_THREADED
    if (b.global_index >= 0) {
        if (!global_lock_for(b.global_index, 0)) return;
        if (b.output) rtos_copy_out<T>(b);
        if (in) rtos_copy_in<T>(b);
        global_unlock(b.global_index);
        return;
    }
#endif
    auto* g = reinterpret_cast<strucpp::GlobalVar<strucpp::IECVar<T>>*>(b.var);
    g->with_lock([&b, in](strucpp::IECVar<T>*) {
        if (b.output) rtos_copy_out<T>(b);
        if (in) rtos_copy_in<T>(b);
    });
}

template <typename T>
static inline void rtos_sync_global_in(ImageBinding& b)
{
    rtos_sync_global<T>(b, true);
}

template <typename T>
static inline void rtos_sync_global_out(ImageBinding& b)
{
    rtos_sync_global<T>(b, false);
}

// Apply one of the copies above to the bindings `owner` selects: one worker's,
// all (ALL), the located globals (GLOBALS), or those no program claims and no
// global list names (NO_OWNER, copied only while no task runs).
#define RTOS_ALL_OWNERS 0x100u
#define RTOS_GLOBALS    0x200u

static inline bool rtos_selected(const ImageBinding& b, unsigned owner)
{
    if (owner == RTOS_ALL_OWNERS) return true;
    if (owner == RTOS_GLOBALS) return b.global;
    if (owner == RTOS_NO_OWNER) return b.owner == RTOS_NO_OWNER && !b.global;
    return b.owner == owner;
}

template <void (*Bit)(ImageBinding&), void (*Word)(ImageBinding&), void (*DWord)(ImageBinding&),
          void (*LWord)(ImageBinding&)>
static inline void rtos_each(unsigned owner, bool outputs_only)
{
    using strucpp::LocatedSize;
    for (uint32_t i = 0; i < s_binding_count; ++i) {
        ImageBinding& b = s_bindings[i];
        if (outputs_only && !b.output) continue;
        if (!rtos_selected(b, owner)) continue;
        switch ((LocatedSize)b.size) {
        case LocatedSize::Bit:   Bit(b);   break;
        case LocatedSize::Word:  Word(b);  break;
        case LocatedSize::DWord: DWord(b); break;
        case LocatedSize::LWord: LWord(b); break;
        default: break;
        }
    }
}

// The cells take the variables' current values: at binding, so declared initial
// values are not lost to the first copy-in, and after a retain restore.
static void runtime_rtos_seed_image()
{
    using namespace strucpp;
    rtos_each<rtos_seed<BOOL_t>, rtos_seed<WORD_t>, rtos_seed<DWORD_t>, rtos_seed<LWORD_t>>(RTOS_ALL_OWNERS, false);
}

static void runtime_rtos_copy_in(unsigned owner)
{
    using namespace strucpp;
    rtos_each<rtos_copy_in<BOOL_t>, rtos_copy_in<WORD_t>, rtos_copy_in<DWORD_t>, rtos_copy_in<LWORD_t>>(owner, false);
}

static void runtime_rtos_copy_out(unsigned owner)
{
    using namespace strucpp;
    rtos_each<rtos_copy_out<BOOL_t>, rtos_copy_out<WORD_t>, rtos_copy_out<DWORD_t>, rtos_copy_out<LWORD_t>>(owner, true);
}

static void runtime_rtos_pin_forced()
{
    using namespace strucpp;
    rtos_each<rtos_pin_forced<BOOL_t>, rtos_pin_forced<WORD_t>, rtos_pin_forced<DWORD_t>, rtos_pin_forced<LWORD_t>>(
        RTOS_ALL_OWNERS, false);
}

// The located globals, every frame: in at frame start (`in`), out when a task
// finishes.
static void runtime_rtos_sync_globals(bool in)
{
    using namespace strucpp;
    if (in) {
        rtos_each<rtos_sync_global_in<BOOL_t>, rtos_sync_global_in<WORD_t>, rtos_sync_global_in<DWORD_t>,
                  rtos_sync_global_in<LWORD_t>>(RTOS_GLOBALS, false);
    } else {
        rtos_each<rtos_sync_global_out<BOOL_t>, rtos_sync_global_out<WORD_t>, rtos_sync_global_out<DWORD_t>,
                  rtos_sync_global_out<LWORD_t>>(RTOS_GLOBALS, true);
    }
}

// ---- Which task owns a debug variable ----------------------------------------
//
// The editor lists, per task, the ranges of the debug table its programs'
// variables occupy (OPENPLC_RTOS_DEBUG_OWNERS in rtos_config.h), by task name.
// A variable in none of them is a global, shared by every task.

struct DebugOwnerRange {
    uint8_t     arr;
    uint16_t    first, last;
    const char* task;
};

#ifdef OPENPLC_RTOS_DEBUG_OWNERS
static const DebugOwnerRange s_owner_ranges[] = OPENPLC_RTOS_DEBUG_OWNERS;
static const uint32_t s_owner_range_count = sizeof(s_owner_ranges) / sizeof(s_owner_ranges[0]);
#else
static const DebugOwnerRange* s_owner_ranges = nullptr;
static const uint32_t s_owner_range_count = 0;
#endif
static uint8_t* s_owner_range_worker = nullptr;   // each range's worker index

static bool names_equal_ci(const char* a, const char* b)
{
    if (!a || !b) return false;
    for (; *a && *b; ++a, ++b) {
        char ca = *a, cb = *b;
        if (ca >= 'a' && ca <= 'z') ca = (char)(ca - 32);
        if (cb >= 'a' && cb <= 'z') cb = (char)(cb - 32);
        if (ca != cb) return false;
    }
    return *a == *b;
}

static uint32_t all_workers(void)
{
    return (s_worker_count >= 32) ? 0xFFFFFFFFu : ((1u << s_worker_count) - 1u);
}

// The task that owns one debug variable, as a bit mask: the worker whose scan a
// service holds to touch it. None for a global in a threaded build, which is
// locked per access by its own mutex; every worker when there is only one.
extern "C" uint32_t runtime_rtos_owner_mask(uint8_t arr, uint16_t elem)
{
    if (s_worker_count <= 1) return all_workers();
    for (uint32_t r = 0; r < s_owner_range_count; ++r) {
        const DebugOwnerRange& o = s_owner_ranges[r];
        if (o.arr == arr && elem >= o.first && elem <= o.last && s_owner_range_worker[r] != RTOS_NO_OWNER)
            return 1u << s_owner_range_worker[r];
    }
    return 0u;
}

// The owners of a run of one debug array, from the ranges themselves, so a
// request naming a wide span costs no more than the number of ranges.
extern "C" uint32_t runtime_rtos_owner_mask_range(uint8_t arr, uint16_t first, uint16_t last)
{
    if (s_worker_count <= 1) return all_workers();
    uint32_t mask = 0;
    for (uint32_t r = 0; r < s_owner_range_count; ++r) {
        const DebugOwnerRange& o = s_owner_ranges[r];
        if (o.arr == arr && o.first <= last && first <= o.last && s_owner_range_worker[r] != RTOS_NO_OWNER)
            mask |= 1u << s_owner_range_worker[r];
    }
    return mask;
}

// ---- Scan locks, from the service side ---------------------------------------

// One owner's scan lock for a comms request: waits up to `wait_us` for a scan
// in progress, not at all for one that has run far past its period (a task
// waiting on the network), so a stalled task costs a request nothing but its own
// answer.
static bool comms_lock_worker(uint32_t w, uint32_t wait_us)
{
    return plc_os_mutex_lock_for(s_workers[w].scan_lock, worker_stalled(w) ? 0 : wait_us);
}

// The scan locks of the workers in `mask`, in index order. The first is waited
// for in full; with that one held, each of the others gets only a short grace,
// since waiting longer would keep the first from starting its next scan. Returns
// the workers actually locked.
static uint32_t comms_lock_workers(uint32_t mask)
{
    uint32_t locked = 0;
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        if (!(mask & (1u << w))) continue;
        const bool got = comms_lock_worker(w, locked == 0 ? OPENPLC_RTOS_COMMS_WAIT_US : OPENPLC_RTOS_COMMS_GRACE_US);
        if (got) locked |= 1u << w;
    }
    return locked;
}

// Take the scan locks of the workers in `mask`, or none: false when one is not
// between scans, which the service answers "busy".
static bool lock_workers_for_comms(uint32_t mask)
{
    const uint32_t locked = comms_lock_workers(mask);
    if (locked == (mask & all_workers())) return true;
    runtime_rtos_unlock_workers(locked);
    return false;
}

// Reads never fail: an owner is read between its scans when its lock comes in
// time, otherwise as it stands, so a stuck task's variables can still be seen.
// Returns the owners actually locked.
extern "C" uint32_t runtime_rtos_lock_workers_for_read(uint32_t mask)
{
    return comms_lock_workers(mask);
}

// The locks for a comms write or force of one variable. A task's own variable
// is written between its scans, a global under its own lock; either is refused
// (false, "busy") when a task does not let go in time. With a STruC++ that has
// no per-global locks, a global is written holding the workers that come
// quickly.
extern "C" bool runtime_rtos_lock_for_write(uint8_t arr, uint16_t elem, runtime_rtos_write_lock_t* held)
{
    held->workers = 0;
    held->global  = -1;
    const uint32_t owners = runtime_rtos_owner_mask(arr, elem);
    if (owners != 0) {
        if (!lock_workers_for_comms(owners)) return false;
        held->workers = owners;
        return true;
    }
#ifdef STRUCPP_THREADED
    const int32_t g = leaf_global(arr, elem);
    if (g >= 0) {
        if (!global_lock_for(g, OPENPLC_RTOS_COMMS_WAIT_US)) return false;
        held->global = g;
        return true;
    }
#endif
    held->workers = runtime_rtos_lock_workers_for_read(all_workers());
    return true;
}

extern "C" void runtime_rtos_unlock_write(const runtime_rtos_write_lock_t* held)
{
#ifdef STRUCPP_THREADED
    global_unlock(held->global);
#endif
    runtime_rtos_unlock_workers(held->workers);
}

// After a protocol's plain write to a variable (OPC-UA's, which is no force):
// a located variable's image cell takes the new value, or the owner's next
// copy-in would put the old one straight back. Called with the variable's
// locks from runtime_rtos_lock_for_write() still held.
extern "C" void runtime_rtos_after_write(uint8_t arr, uint16_t elem)
{
    using namespace strucpp;
    uint16_t len = 0;
    const void* var = openplc_debug_ptr(arr, elem, &len);
    if (!var) return;
    plc_os_mutex_lock(s_image_lock);
    for (uint32_t i = 0; i < s_binding_count; ++i) {
        ImageBinding& b = s_bindings[i];
        if (b.var != var) continue;
        switch ((LocatedSize)b.size) {
        case LocatedSize::Bit:   rtos_seed<BOOL_t>(b);  break;
        case LocatedSize::Word:  rtos_seed<WORD_t>(b);  break;
        case LocatedSize::DWord: rtos_seed<DWORD_t>(b); break;
        case LocatedSize::LWord: rtos_seed<LWORD_t>(b); break;
        default: break;
        }
        break;
    }
    plc_os_mutex_unlock(s_image_lock);
}

extern "C" void runtime_rtos_unlock_workers(uint32_t mask)
{
    for (uint32_t w = s_worker_count; w-- > 0;) {
        if (mask & (1u << w)) plc_os_mutex_unlock(s_workers[w].scan_lock);
    }
}

// ---- Setting the workers up ---------------------------------------------------

// Called once from plc_rtos_start(), after runtime_discover_tasks(): one worker
// per IEC task when the runtime is threaded, else one worker for all of them.
extern "C" void runtime_rtos_prepare_workers(void)
{
    auto* resources = g_config.get_resources();
#ifdef STRUCPP_THREADED
    uint32_t count = 0;
    for (size_t r = 0; r < g_config.get_resource_count(); ++r) count += (uint32_t)resources[r].task_count;
    if (count == 0) count = 1;
    if (count > OPENPLC_RTOS_MAX_WORKERS) count = OPENPLC_RTOS_MAX_WORKERS;
    s_workers = new RtosWorker[count]();
    s_worker_count = 0;
    for (size_t r = 0; r < g_config.get_resource_count(); ++r) {
        for (size_t t = 0; t < resources[r].task_count && s_worker_count < count; ++t) {
            auto&          task     = resources[r].tasks[t];
            const uint64_t interval = task.interval_ns > 0 ? (uint64_t)task.interval_ns : RTOS_DEFAULT_INTERVAL_NS;
            RtosWorker&    k        = s_workers[s_worker_count++];
            k.name             = task.name;
            k.priority         = task.priority;
            k.release_divisor  = (uint32_t)(interval / base_tick_ns);
            if (k.release_divisor == 0) k.release_divisor = 1;
            k.programs         = task.programs;
            k.program_divisors = nullptr;
            k.program_next     = nullptr;
            k.program_count    = task.program_count;
        }
    }
#else
    // Not threaded: every task on one worker, released every base tick, running
    // each program when its task's period is due. Each program keeps the grid
    // tick it is next due at, so a release skipped by an overrun delays a slower
    // program to the next release instead of skipping it.
    s_workers = new RtosWorker[1]();
    s_worker_count = 1;
    uint32_t* divisors = new uint32_t[total_programs > 0 ? total_programs : 1];
    size_t    p        = 0;
    for (size_t r = 0; r < g_config.get_resource_count(); ++r) {
        for (size_t t = 0; t < resources[r].task_count; ++t) {
            auto&          task     = resources[r].tasks[t];
            const uint64_t interval = task.interval_ns > 0 ? (uint64_t)task.interval_ns : RTOS_DEFAULT_INTERVAL_NS;
            uint32_t       divisor  = (uint32_t)(interval / base_tick_ns);
            if (divisor == 0) divisor = 1;
            for (size_t n = 0; n < task.program_count && p < total_programs; ++n) divisors[p++] = divisor;
        }
    }
    s_workers[0].name             = "PLC";
    s_workers[0].priority         = 0;
    s_workers[0].release_divisor  = 1;
    s_workers[0].programs         = all_programs;
    s_workers[0].program_divisors = divisors;
    s_workers[0].program_next     = new uint64_t[total_programs > 0 ? total_programs : 1]();
    s_workers[0].program_count    = total_programs;
#endif
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        s_workers[w].scan_lock       = plc_os_mutex_create();
        s_workers[w].scan_started_us = 0;
        s_workers[w].scan_active     = false;
        if (!s_workers[w].scan_lock) runtime_rtos_fault();
    }

    if (s_owner_range_count > 0) {
        s_owner_range_worker = new uint8_t[s_owner_range_count];
        for (uint32_t r = 0; r < s_owner_range_count; ++r) {
            s_owner_range_worker[r] = RTOS_NO_OWNER;
            for (uint32_t w = 0; w < s_worker_count; ++w) {
                if (names_equal_ci(s_owner_ranges[r].task, s_workers[w].name)) s_owner_range_worker[r] = (uint8_t)w;
            }
        }
    }

    runtime_rtos_assign_owners();
}

// ---- The dispatcher's half ----------------------------------------------------

// Frame start: the HAL reads the inputs into the image and forced values are
// pinned over them. Located globals sync both ways under their own locks,
// whatever the tasks are doing; a NO_OWNER binding only with every task idle.
extern "C" void runtime_rtos_frame_input(bool all_idle)
{
    plc_os_mutex_lock(s_image_lock);
    updateInputBuffers();
    runtime_rtos_pin_forced();
    if (__atomic_load_n(&plc_state, __ATOMIC_ACQUIRE) == PLC_STATE_RUNNING) {
        runtime_rtos_sync_globals(true);
        if (all_idle) {
            runtime_rtos_copy_out(RTOS_NO_OWNER);
            runtime_rtos_copy_in(RTOS_NO_OWNER);
        }
    }
    plc_os_mutex_unlock(s_image_lock);
}

// Frame end: the image goes to the outputs, forced outputs pinned over any
// protocol write. While stopped they are zeroed in the same hold as the HAL
// write, so no protocol write can energise one. Called per finished task.
extern "C" void runtime_rtos_frame_output(bool all_idle, bool stopping)
{
    plc_os_mutex_lock(s_image_lock);
    const bool running = __atomic_load_n(&plc_state, __ATOMIC_ACQUIRE) == PLC_STATE_RUNNING;
    if (running) {
        runtime_rtos_sync_globals(false);
        if (all_idle) runtime_rtos_copy_out(RTOS_NO_OWNER);
    }
    runtime_rtos_pin_forced();
    // Stopped, or stopping while tasks finish their last scan: outputs off now.
    if (!running || stopping) runtime_zero_output_image();
    updateOutputBuffers();
    plc_os_mutex_unlock(s_image_lock);
}

// The state the switch and the software latch ask for. Called by the
// dispatcher every base tick; it owns the HAL, so the switch is read here.
extern "C" uint8_t runtime_rtos_wanted_state(void)
{
    // Under the image lock, as every HAL call is: a service may be in one.
    plc_os_mutex_lock(s_image_lock);
    const uint8_t sw = hardwareStateSwitch();
    plc_os_mutex_unlock(s_image_lock);
    if (sw == PLC_SWITCH_RUN && last_switch == PLC_SWITCH_STOP)
        __atomic_store_n(&software_stop, false, __ATOMIC_RELEASE);
    last_switch = sw;
    __atomic_store_n(&switch_position, sw, __ATOMIC_RELEASE);
    const bool stop_requested = __atomic_load_n(&software_stop, __ATOMIC_ACQUIRE);
    return (sw == PLC_SWITCH_STOP || stop_requested) ? PLC_STATE_STOPPED : PLC_STATE_RUNNING;
}

extern "C" uint8_t runtime_rtos_state(void) { return __atomic_load_n(&plc_state, __ATOMIC_ACQUIRE); }

static void lock_all_workers(void)
{
    for (uint32_t w = 0; w < s_worker_count; ++w) plc_os_mutex_lock(s_workers[w].scan_lock);
}

static void unlock_all_workers(void) { runtime_rtos_unlock_workers(all_workers()); }

// RUN -> STOP, a cold stop: save the values the last scans left (the periodic
// save may be a period old), commit them, then re-initialise the program.
// Called with every task idle; every scan lock keeps services out of g_config.
extern "C" void runtime_rtos_enter_stop(void)
{
    lock_all_workers();
    runtime_retain_save();
    runtime_retain_flush();
    plc_os_mutex_lock(s_image_lock);   // re-initialisation rewrites the cells too
    runtime_reinit_program();
    __atomic_store_n(&plc_state, (uint8_t)PLC_STATE_STOPPED, __ATOMIC_RELEASE);
    plc_os_mutex_unlock(s_image_lock);
    unlock_all_workers();
}

// STOP -> RUN at `run_tick`: restore retain (a no-op unless the driver dropped
// the store), and start every program's grid on the first scan.
extern "C" void runtime_rtos_enter_run(uint64_t run_tick)
{
    lock_all_workers();
    plc_os_mutex_lock(s_image_lock);   // a restore seeds the cells
    runtime_retain_load();
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        if (s_workers[w].program_next) {
            for (size_t p = 0; p < s_workers[w].program_count; ++p) s_workers[w].program_next[p] = run_tick;
        }
    }
    __atomic_store_n(&plc_state, (uint8_t)PLC_STATE_RUNNING, __ATOMIC_RELEASE);
    plc_os_mutex_unlock(s_image_lock);
    unlock_all_workers();
}

// While stopped no task runs, so the dispatcher copies the image into the
// located variables itself, keeping field data visible to the debugger.
// Skipped for a frame a service is inside.
extern "C" void runtime_rtos_stopped_copy_in(void)
{
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        if (!plc_os_mutex_lock_for(s_workers[w].scan_lock, 0)) {
            runtime_rtos_unlock_workers((1u << w) - 1u);
            return;
        }
    }
    plc_os_mutex_lock(s_image_lock);
    runtime_rtos_copy_in(RTOS_ALL_OWNERS);
    plc_os_mutex_unlock(s_image_lock);
    unlock_all_workers();
}

// Retained values go to the platform between the owners' scans. A task stalled
// in a block is packed as it stands, so it cannot stop retain for good. False,
// skipping this frame, when a task is mid-scan (not stalled) or a service holds
// its lock.
extern "C" bool runtime_rtos_retain_save(void)
{
    uint32_t locked = 0;
    for (uint32_t w = 0; w < s_worker_count; ++w) {
        if (plc_os_mutex_lock_for(s_workers[w].scan_lock, 0)) {
            locked |= 1u << w;
        } else if (!worker_stalled(w)) {
            runtime_rtos_unlock_workers(locked);
            return false;
        }
    }
    runtime_retain_save();
    runtime_rtos_unlock_workers(locked);
    return true;
}

// ---- A worker's cycle -----------------------------------------------------------

// One release of worker `w`. `run_tick` is the dispatcher's count of base ticks
// run so far, skipped releases included: IEC time is that grid time, so
// TON/TOF keep wall-clock time across an overrun.
extern "C" void runtime_rtos_worker_cycle(uint32_t w, uint64_t run_tick)
{
    RtosWorker& k = s_workers[w];
    plc_os_mutex_lock(k.scan_lock);
    __atomic_store_n(&k.scan_started_us, (uint32_t)plc_os_now_us(), __ATOMIC_RELEASE);
    __atomic_store_n(&k.scan_active, true, __ATOMIC_RELEASE);

    plc_os_mutex_lock(s_image_lock);
    runtime_rtos_copy_in(w);
    plc_os_mutex_unlock(s_image_lock);

    // This worker's IEC time (per thread when threaded).
#if defined(STRUCPP_THREADED) && defined(STRUCPP_PLATFORM_THREADS)
    __atomic_store_n(&k.thread, plc_os_task_self(), __ATOMIC_RELAXED);
    k.time_ns = (int64_t)run_tick * (int64_t)base_tick_ns;
#else
    strucpp::__CURRENT_TIME_NS = (int64_t)run_tick * (int64_t)base_tick_ns;
#endif
    for (size_t i = 0; i < k.program_count; ++i) {
        const uint32_t d = k.program_divisors ? k.program_divisors[i] : 1;
        if (d > 1) {
            // Due at its grid point, or at the latest one reached when releases
            // were skipped past it; the next is the grid point after that.
            uint64_t& next = k.program_next[i];
            if (run_tick < next) continue;
            next = run_tick - (run_tick - next) % d + d;
        }
        k.programs[i]->run();
    }

    plc_os_mutex_lock(s_image_lock);
    runtime_rtos_copy_out(w);
    plc_os_mutex_unlock(s_image_lock);

    __atomic_store_n(&k.scan_active, false, __ATOMIC_RELEASE);
    plc_os_mutex_unlock(k.scan_lock);
}
#endif // OPENPLC_RTOS

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
#if OPENPLC_RTOS && defined(STRUCPP_THREADED)
    // A global under its own lock when a task lets it go within a moment;
    // otherwise read as it stands, as a stalled task's variables are.
    const int32_t g = leaf_global(arr, elem);
    const bool held = global_lock_for(g, OPENPLC_RTOS_COMMS_GRACE_US);
    const uint16_t n = strucpp::debug::handle_read(arr, elem, dest);
    if (held) global_unlock(g);
    return n;
#else
    return strucpp::debug::handle_read(arr, elem, dest);
#endif
}

extern "C" uint8_t openplc_debug_set(uint8_t arr, uint16_t elem, uint8_t forcing,
                                     const uint8_t* bytes, uint16_t len)
{
    return strucpp::debug::handle_set(arr, elem, forcing != 0, bytes, len);
}

extern "C" uint8_t openplc_debug_write(uint8_t arr, uint16_t elem,
                                       const uint8_t* bytes, uint16_t len)
{
    return strucpp::debug::handle_write(arr, elem, bytes, len);
}

extern "C" const void* openplc_debug_ptr(uint8_t arr, uint16_t elem, uint16_t* out_len)
{
    return strucpp::debug::handle_ptr(arr, elem, out_len);
}

// The status macros in arduino_runtime_glue.h exist so the other side of the
// boundary never has to include debug_dispatch.hpp. This is the one place that
// sees both, so this is where they are held to each other.
static_assert(OPENPLC_DEBUG_STATUS_OK == strucpp::debug::STATUS_OK,
              "OPENPLC_DEBUG_STATUS_OK drifted from strucpp::debug::STATUS_OK");
static_assert(OPENPLC_DEBUG_STATUS_OUT_OF_BOUNDS == strucpp::debug::STATUS_OUT_OF_BOUNDS,
              "OPENPLC_DEBUG_STATUS_OUT_OF_BOUNDS drifted from strucpp::debug::STATUS_OUT_OF_BOUNDS");
static_assert(OPENPLC_DEBUG_STATUS_DATA_TOO_LARGE == strucpp::debug::STATUS_DATA_TOO_LARGE,
              "OPENPLC_DEBUG_STATUS_DATA_TOO_LARGE drifted from strucpp::debug::STATUS_DATA_TOO_LARGE");

// Same reasoning for the string wire widths. `modbus_types.h` sizes the Modbus
// frame from them -- a frame that cannot hold the widest value skips it in
// silence, which is how a WSTRING read came back empty rather than failing --
// and that header is plain C++ and cannot include debug_dispatch.hpp. This is
// again the one place that sees both.
static_assert(OPENPLC_DEBUG_STRING_WIRE == strucpp::debug::DEBUG_STRING_WIDTH,
              "OPENPLC_DEBUG_STRING_WIRE drifted from strucpp::debug::DEBUG_STRING_WIDTH");
// opcua_types.h names the two string tags for plain-C callers (the branch
// between "scalar" and "{length, data} header" is not a table lookup). This TU
// is the only place that sees both that header and strucpp's enum, so it is
// where the duplication is held honest.
static_assert(OPENPLC_DEBUG_STRING_CAP == strucpp::debug::DEBUG_STRING_CAP,
              "OPENPLC_DEBUG_STRING_CAP disagrees with strucpp's DEBUG_STRING_CAP");

static_assert(OPCUA_TAG_STRING == strucpp::debug::TAG_STRING,
              "OPCUA_TAG_STRING in opcua_types.h disagrees with strucpp's TypeTag");
static_assert(OPCUA_TAG_WSTRING == strucpp::debug::TAG_WSTRING,
              "OPCUA_TAG_WSTRING in opcua_types.h disagrees with strucpp's TypeTag");

static_assert(OPENPLC_DEBUG_WSTRING_WIRE == strucpp::debug::DEBUG_WSTRING_WIDTH,
              "OPENPLC_DEBUG_WSTRING_WIRE drifted from strucpp::debug::DEBUG_WSTRING_WIDTH");
