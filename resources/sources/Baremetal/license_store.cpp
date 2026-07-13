/*
license_store.cpp - Compile-time backend selection for the license store (OLS-07)
Copyright (C) 2022 OpenPLC - Thiago Alves

Selects exactly one storage backend for the target architecture. The chosen
backend's TU is compiled in via #include (each backend is itself gated on the
same macro, so it is inert if picked up by the build system independently).
SAMD/STM32/RP2040 are outside the MVP and hit the #error until a backend exists.
*/

#if defined(ARDUINO_ARCH_ESP32)
    #include "license_store_esp32.cpp"
#elif defined(ARDUINO_ARCH_AVR)
    #include "license_store_avr.cpp"
#else
    #error "license_store: no storage backend for this architecture (need ESP32 or AVR)"
#endif
