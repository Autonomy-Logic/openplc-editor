/*
modbus_config.h - Build configuration for the OpenPLC Modbus slave
Copyright (C) 2022 OpenPLC - Thiago Alves

The single place every Modbus translation unit picks up its build gates from.
It pulls in the generated defines.h (MODBUS_ENABLED / MBSERIAL / DEBUGGER_ENABLED
/ MBTCP / MBSERIAL_ON_SECONDARY / ...) and derives the composite gates on top of
it. Because the modularized TUs are gated (e.g. modbus_registers.cpp is wrapped
in #ifdef MODBUS_ENABLED), EACH of them must see these macros — so every modbus_*
header includes this one (via modbus_types.h). defines.h has no include guard, so
it must reach a TU through exactly one path: this header.
*/

#ifndef MODBUS_CONFIG_H
#define MODBUS_CONFIG_H

#include <Arduino.h>
#include "defines.h"

// Serial transport is active when full Modbus RTU (MBSERIAL) is enabled OR the
// always-on debugger (DEBUGGER_ENABLED) needs the serial port without the rest
// of Modbus. This gate guards the serial RX/framing code so the debugger works
// over serial even when no Modbus operation buffers (coils/holding/etc.) are
// allocated.
#if defined(MBSERIAL) || defined(DEBUGGER_ENABLED)
    #define MB_SERIAL_ACTIVE
#endif

// Default serial config for the always-on debugger. `defines.h` normally emits
// DEBUG_IFACE / DEBUG_BAUD / DEBUG_SLAVE explicitly (from the Serial and Modbus
// RTU screens); these `#ifndef` defaults cover anything it left unset — they are
// a fallback for a hand-written defines.h, NOT the expected path. When they do
// apply, they must agree with what the editor dials, so they mirror
// `generate-defines.ts` (Serial @ 115200, slave id 1).
// Defined whenever the debugger is on —
// including alongside full Modbus RTU, since the dual-serial path (RTU on a
// secondary UART, MBSERIAL_ON_SECONDARY) needs DEBUG_SLAVE for the default port.
#ifdef DEBUGGER_ENABLED
    #ifndef DEBUG_IFACE
        #define DEBUG_IFACE Serial
    #endif
    #ifndef DEBUG_BAUD
        #define DEBUG_BAUD 115200
    #endif
    #ifndef DEBUG_SLAVE
        #define DEBUG_SLAVE 1
    #endif
#endif

#endif
