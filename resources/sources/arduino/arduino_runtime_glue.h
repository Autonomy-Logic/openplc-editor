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

#ifdef __cplusplus
}
#endif

#endif // OPENPLC_ARDUINO_RUNTIME_GLUE_H
