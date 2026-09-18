// arduino_runtime_glue.h — sketch-facing surface for Arduino targets.
//
// Companion to runtime_v4_entry.cpp/.h: same role of bridging strucpp's C++
// runtime ABI to a static host (here, an Arduino .ino), except the producer
// is the Arduino sketch rather than the OpenPLC v4 daemon. Lives in
// strucpp/runtime/ alongside the v4 shim so the runtime-ABI surface is
// owned in one place.
//
// Why a thin C-linkage header instead of just #include "generated.hpp" in
// the sketch: the Arduino build automatically prepends `#include
// <Arduino.h>` to every .ino TU. Arduino.h defines preprocessor macros
// named DEFAULT / HIGH / LOW / PI / B0..B7 / INPUT / OUTPUT and others that
// collide with struct member names emitted by strucpp's library bodies
// (most visibly OSCAT's CONSTANTS_LANGUAGE, but the problem is general —
// IEC 61131-3 allows those identifiers as variable names). Keeping every
// strucpp class body out of the .ino's translation unit removes the entire
// class of collisions in one move.
//
// This header MUST stay free of:
//   - any #include of generated.hpp or iec_*.hpp
//   - any reference to namespace strucpp
//   - any type whose name might be macro-replaced by Arduino.h

#ifndef OPENPLC_ARDUINO_RUNTIME_GLUE_H
#define OPENPLC_ARDUINO_RUNTIME_GLUE_H

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

// Globals owned by arduino_runtime_glue.cpp, read by the sketch.
extern unsigned long long base_tick_ns;
extern uint32_t scan_counter;

// Setup-time helpers (call once from setup()).
void runtime_bind_located_vars();
void runtime_discover_tasks();

// Establish the initial run/stop state. Call once from setup() AFTER
// hardwareInit(), so the HAL has already configured its switch pin. Reads
// the mode switch: a board powered up with the switch in STOP never
// executes a scan.
void runtime_init_plc_state();

// Per-cycle helpers (call once per scan cycle from scheduler()/loop()).
void runtime_plc_cycle();

// ---------------------------------------------------------------------------
// Retain variables.
//
// The runtime marshals; the platform stores (see Baremetal/openplc_retain.h).
// `runtime_plc_cycle()` already hands the current values over once per scan,
// so the sketch only has to bring the pair below up at start.
// ---------------------------------------------------------------------------

// Decide once what this runtime can do about retention: does the program retain
// anything, and does its blob fit the buffer this firmware allocated. Call from
// setup() BEFORE runtime_retain_load().
//
// `program_md5` is PROGRAM_MD5 from the generated defines.h — 32 hex characters
// identifying the program. It is passed in rather than read here because
// defines.h has no include guard and must reach a translation unit through
// exactly one path (modbus_config.h), which the glue is not on. The driver uses
// it to tell whether the values it holds belong to the program now running; see
// Baremetal/openplc_retain.h.
void runtime_retain_init(const char *program_md5);

// Restore the stored values. Call from setup() after runtime_retain_init().
// Also called internally on the transition into RUN and after a program
// re-initialisation, so a STOP does not behave as a cold start. Idempotent.
void runtime_retain_load();

// Ask the driver to commit anything it is still holding. Called internally on
// the transition into STOP. A hint, not the durability mechanism — that is the
// per-scan write. See Baremetal/openplc_retain.h.
void runtime_retain_flush();

// ---------------------------------------------------------------------------
// Run/stop control surface.
//
// State is derived every cycle from the mode switch (hardwareStateSwitch(),
// PLC_SWITCH_RUN when no HAL implements it) and a software-request latch set
// through runtime_request_plc_state():
//
//   switch   software request   state
//   ------   ----------------   -----
//   RUN      run (default)      RUNNING     <- every board with no switch
//   RUN      stop               STOPPED
//   STOP     (ignored)          STOPPED     <- hardware is authoritative
//
// A STOP -> RUN edge on the switch resets the software request to `run`, so
// a physical flip to RUN always puts the PLC in RUN -- otherwise a
// software-stopped device would sit dead in the RUN position with no local
// way to recover.
//
// runtime_get_plc_state() is declared in openplc.h because HALs call it to
// drive a status LED.
// ---------------------------------------------------------------------------

// Result codes for runtime_request_plc_state().
#define PLC_CTRL_OK                   0
#define PLC_CTRL_REFUSED_SWITCH_STOP  1
#define PLC_CTRL_INVALID              2

// Last value read from hardwareStateSwitch() (PLC_SWITCH_*).
uint8_t runtime_get_switch_position(void);

// Ask for PLC_STATE_RUNNING or PLC_STATE_STOPPED. A request to run while the
// mode switch reads STOP is REFUSED, not queued -- the caller reports that
// to the user rather than retrying. Returns PLC_CTRL_*.
uint8_t runtime_request_plc_state(uint8_t desired_state);

// Re-impose forced located variables' values onto their raw storage. Call
// after any code path that writes the image pointers directly (HAL input
// refresh, Modbus reverse-copy) so a debugger force is not clobbered. Cheap
// no-op when nothing is forced. runtime_plc_cycle() already calls it after
// the input refresh; the sketch must also call it after modbusTask()'s
// reverse-copy.
void runtime_apply_located_forces();

// ---------------------------------------------------------------------------
// Debug dispatch shims — extern "C" wrappers around strucpp::debug::handle_*.
//
// ModbusSlave.cpp used to include `debug_dispatch.hpp` directly to reach
// these calls, but that pulled the strucpp template-heavy headers into the
// sketch's TU (compiled by arduino-cli with the core's default C++ standard
// — typically gnu++14 on mbed). The strucpp runtime needs C++17, so the
// direct include broke every non-AVR build. Wrapping the surface here lets
// ModbusSlave.cpp speak plain C against a stable ABI while the actual
// strucpp invocations stay in arduino_runtime_glue.cpp, which is compiled
// into the precompiled OpenPLCUserLib archive with -std=gnu++17.
// ---------------------------------------------------------------------------

uint8_t  openplc_debug_array_count(void);
uint16_t openplc_debug_elem_count(uint8_t arr);
uint16_t openplc_debug_size(uint8_t arr, uint16_t elem);
uint16_t openplc_debug_read(uint8_t arr, uint16_t elem, uint8_t* dest);
uint8_t  openplc_debug_set(uint8_t arr, uint16_t elem, uint8_t forcing, const uint8_t* bytes, uint16_t len);

// ---------------------------------------------------------------------------
// Process image access, for protocols that address LOCATED variables.
//
// Modbus and S7comm serve `AT %...` declarations; OPC-UA serves every program
// variable and goes through openplc_debug_* above instead. This is the surface
// for the first kind: it hands out a pointer into the image so a protocol never
// needs a mirror buffer of its own.
//
// THE COUNT IS SEPARATE FROM THE POINTER ON PURPOSE. A NULL from the accessors
// means EITHER out of range OR in range with no variable bound, and the two
// need different answers on the wire: Modbus owes MB_EX_ILLEGAL_ADDRESS for the
// first and a legitimate zero for the second. With the count exposed, the
// protocol decides that and the accessor only addresses storage. It is the same
// split Runtime v4 has between image_table_capacity() and indexing the table.
//
// ONE INVARIANT, both families: an index is valid exactly while
//   index < openplc_image_count(area)
// `_slot` serves the word-and-wider areas, `_bit` the three bit areas, and the
// count is in whichever unit that area's addresses use.
// ---------------------------------------------------------------------------

/** The small AVRs carry only the four basic tables: no %M area and no REAL
 *  I/O. openplc.h splits on exactly this list, and the split is by MCU rather
 *  than by whether a MAX_* is defined, because the editor emits all nine
 *  macros for every target while the arrays exist only on the larger one. */
#if defined(__AVR_ATmega328P__) || defined(__AVR_ATmega168__) || \
    defined(__AVR_ATmega32U4__) || defined(__AVR_ATmega16U4__)
#define OPENPLC_HAS_EXTENDED_AREAS 0
#else
#define OPENPLC_HAS_EXTENDED_AREAS 1
#endif

/** The nine areas bare metal declares storage for. Values are part of the ABI
 *  between the library and the sketch's translation unit; append, never
 *  renumber. The five areas Runtime v4 has and bare metal does not (%IB, %QB,
 *  %IL, %QL, %MX) are absent rather than present-and-empty: a protocol asking
 *  for one gets OPENPLC_AREA_NONE from any lookup that names areas. */
typedef enum
{
    OPENPLC_AREA_BOOL_INPUT  = 0,  /* %IX, counted in bits  */
    OPENPLC_AREA_BOOL_OUTPUT = 1,  /* %QX, counted in bits  */
    OPENPLC_AREA_INT_INPUT   = 2,  /* %IW */
    OPENPLC_AREA_INT_OUTPUT  = 3,  /* %QW */
    OPENPLC_AREA_REAL_INPUT  = 4,  /* %ID, IEC_REAL on this runtime */
    OPENPLC_AREA_REAL_OUTPUT = 5,  /* %QD, IEC_REAL on this runtime */
    OPENPLC_AREA_INT_MEMORY  = 6,  /* %MW */
    OPENPLC_AREA_DINT_MEMORY = 7,  /* %MD */
    OPENPLC_AREA_LINT_MEMORY = 8,  /* %ML */
    OPENPLC_AREA_NONE        = 9
} openplc_image_area_t;

/** Addressable units in this area, in the unit its addresses use: BITS for the
 *  two bit areas, elements for the rest. Zero for an area this target does not
 *  have, which is every %M area and both REAL areas on a small AVR.
 *
 *  For a bit area this is the count the ARRAY can hold, `(MAX/8) * 8`, not the
 *  MAX_* macro. They are equal in any build the editor produced, which pads the
 *  bit macros to a whole byte and asserts it below, but a hand-written
 *  defines.h with a remainder would otherwise report slots that the [MAX/8][8]
 *  declaration has no room for. */
uint16_t openplc_image_count(openplc_image_area_t area);

/** The storage behind slot `index` of a word-and-wider area, or NULL when the
 *  index is out of range or no located variable is bound there.
 *
 *  `width` receives the element size in bytes and is set even when the return
 *  is NULL, so a caller can tell "this target has no such area" (width 0) from
 *  "the area exists, that slot is empty" (width set) without a second call.
 *  Passing a bit area here yields NULL with width 0: use openplc_image_bit. */
void* openplc_image_slot(openplc_image_area_t area, uint16_t index, uint8_t* width);

/** The storage behind one bit of a bit area, addressed by its FLAT bit index
 *  so the caller does not repeat the [byte][bit] split. NULL out of range or
 *  unbound. IEC_BOOL is uint8_t; the header stays free of openplc.h. */
uint8_t* openplc_image_bit(openplc_image_area_t area, uint16_t bit_index);

#ifdef __cplusplus
}
#endif

#endif // OPENPLC_ARDUINO_RUNTIME_GLUE_H
