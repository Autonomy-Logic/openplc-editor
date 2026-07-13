/*
license_store.cpp - Compile-time backend guard for the license store (OLS-07)
Copyright (C) 2022 OpenPLC - Thiago Alves

Each backend TU (license_store_esp32.cpp / license_store_avr.cpp) self-gates its
whole body on its architecture macro, so the Arduino build system — which compiles
every .cpp in the sketch folder as its own translation unit — links in exactly one.

This file therefore does NOT #include the backend .cpp files: doing so would define
their symbols a second time (once here via the include, once in the backend's own
TU), which the linker rejects as "multiple definition". Its only job is to fail the
build with a clear message on architectures that have no backend yet
(SAMD/STM32/RP2040 are outside the MVP).
*/

#if !defined(ARDUINO_ARCH_ESP32) && !defined(ARDUINO_ARCH_AVR)
    #error "license_store: no storage backend for this architecture (need ESP32 or AVR)"
#endif
