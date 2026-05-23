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

// Per-cycle helpers (call once per scan cycle from scheduler()/loop()).
void runtime_plc_cycle();

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

#ifdef __cplusplus
}
#endif

#endif // OPENPLC_ARDUINO_RUNTIME_GLUE_H
