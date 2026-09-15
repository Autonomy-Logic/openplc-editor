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
//
// Every slot write below is range-checked. locatedVars[] is authored from
// whatever `AT %...` the user typed, and nothing in the descriptor itself
// says how big this firmware's process image is -- so an address past the
// end (`%QX7.0` on a 56-output image: byte_index 7 against bool_output[7][8])
// used to write straight past the array and corrupt whatever followed it.
// Only the DWord cases were guarded; the rest are now (openplc-editor#296).
//
// The editor rejects an out-of-range location before the build gets here,
// so reaching a skip is not the expected path -- this is the backstop for a
// hand-written .st, a project moved to a smaller board, or a stale build.
// Dropping the binding leaves the slot NULL, which every HAL and the Modbus
// glue already treat as "not wired" and step over.
//
// The bit-addressed buffers are declared [MAX/8][8], so the bound to check
// is the FIRST dimension: an image whose digital count isn't a multiple of 8
// rounds down, and the slots in the partial byte are unaddressable.
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
                if (lv.byte_index < (MAX_DIGITAL_INPUT / 8) && lv.bit_index < 8) {
                    bool_input[lv.byte_index][lv.bit_index] = (::IEC_BOOL*)lv.pointer;
                }
                break;
            case LocatedSize::Word:
                if (lv.byte_index < MAX_ANALOG_INPUT) {
                    int_input[lv.byte_index] = (::IEC_UINT*)lv.pointer;
                }
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
                if (lv.byte_index < (MAX_DIGITAL_OUTPUT / 8) && lv.bit_index < 8) {
                    bool_output[lv.byte_index][lv.bit_index] = (::IEC_BOOL*)lv.pointer;
                }
                break;
            case LocatedSize::Word:
                if (lv.byte_index < MAX_ANALOG_OUTPUT) {
                    int_output[lv.byte_index] = (::IEC_UINT*)lv.pointer;
                }
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
                if (lv.byte_index < MAX_MEMORY_WORD) {
                    int_memory[lv.byte_index] = (::IEC_UINT*)lv.pointer;
                }
                break;
            case LocatedSize::DWord:
                if (lv.byte_index < MAX_MEMORY_DWORD) {
                    dint_memory[lv.byte_index] = (::IEC_UDINT*)lv.pointer;
                }
                break;
            case LocatedSize::LWord:
                if (lv.byte_index < MAX_MEMORY_LWORD) {
                    lint_memory[lv.byte_index] = (::IEC_ULINT*)lv.pointer;
                }
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

// Cap on the retain blob this firmware will handle. Sized for the boards the
// editor targets, and deliberately a fixed allocation: this buffer is filled
// from inside the scan cycle, so it cannot come from the heap.
#define RETAIN_BUFFER_MAX 512

// A program that outgrows the buffer FAILS THE BUILD.
//
// The editor emits OPLC_RETAIN_BLOB_SIZE into defines.h whenever a program
// retains anything, and the check has to happen here because there is nowhere
// else for it to happen: a microcontroller has no console to report on, so the
// alternative is firmware that links, runs, quietly decides the blob will not
// fit and behaves as NON_RETAIN — on a machine somebody has already installed,
// with the fault only visible after a power cycle.
//
// Retained state adds up faster than it looks. A retained TON is 36 bytes
// (four interface leaves plus the four internal ones that make it a timer),
// so this cap is reached at around fourteen of them.
#ifdef OPLC_RETAIN_BLOB_SIZE
static_assert(OPLC_RETAIN_BLOB_SIZE <= RETAIN_BUFFER_MAX,
              "This program's retained variables need more storage than this "
              "board's retain buffer holds (RETAIN_BUFFER_MAX). Retain fewer "
              "variables, or mark some of them NON_RETAIN. Remember that a "
              "retained function block instance retains all of its internal "
              "state, not only its inputs and outputs.");
#endif

static uint8_t  retain_buffer[RETAIN_BUFFER_MAX];
static uint16_t retain_blob_len   = 0;   // 0 = nothing retained, or unusable
static bool     retain_available  = false;

// This program's identity, handed to the driver on every read so it can tell
// whether what it is holding belongs to the program now running. Supplied by
// the sketch from PROGRAM_MD5 rather than read from defines.h here: defines.h
// has no include guard and must reach a translation unit through exactly one
// path (modbus_config.h), which this file is deliberately not on.
static const char *retain_program_md5 = nullptr;

static uint16_t retain_read_leaf(uint8_t arr, uint16_t elem, uint8_t* dest) {
    return strucpp::debug::handle_read(arr, elem, dest);
}

// A PLAIN write, never a force. Restoring a retained value must not pin it: the
// program has to be able to move it on the very next scan, and an operator's
// force has to stay authoritative over whatever was stored.
static uint8_t retain_write_leaf(uint8_t arr, uint16_t elem, const uint8_t* bytes, uint16_t len) {
    return strucpp::debug::handle_write(arr, elem, bytes, len);
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
void runtime_retain_init(const char *program_md5)
{
    retain_available    = false;
    retain_blob_len     = 0;
    retain_program_md5  = program_md5;

    const size_t needed = strucpp::retain::blob_size(retain_size_leaf);
    if (needed == 0) return;           // the program retains nothing
    // Unreachable when the editor supplied OPLC_RETAIN_BLOB_SIZE — the
    // static_assert above already refused the build. Kept for firmware built
    // by other means, where silently degrading still beats overrunning.
    if (needed > RETAIN_BUFFER_MAX) return;

    retain_blob_len  = (uint16_t)needed;
    retain_available = true;
}

// ---------------------------------------------------------------------------
// Restore. Call after the IEC variables exist and before the first scan — on
// the transition into RUN, and after any re-initialisation, because that
// re-runs every declared initialiser and would otherwise make a STOP behave as
// a cold start. Idempotent by design, so calling it at all three is fine.
//
// The driver is handed this program's identity and decides for itself whether
// what it holds still belongs here; a store it has just discarded answers
// NO_DATA, exactly like a store that never held anything. Anything the runtime
// cannot trust on top of that (bad magic, wrong format, failed crc, a layout
// from a different program) leaves every variable at its initial value. That is
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
        retain_buffer, sizeof(retain_buffer), retain_read_leaf, retain_size_leaf);
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
    // normally changes them while stopped, so this is usually a no-op — except
    // in the one case that matters: a driver that discarded the store because
    // the program changed. Idempotent, so calling it on every RUN edge is safe.
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
        strucpp::__CURRENT_TIME_NS += (int64_t)base_tick_ns;
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
