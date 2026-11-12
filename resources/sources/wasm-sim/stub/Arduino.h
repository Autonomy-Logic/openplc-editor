/**
 * Arduino.h for the WebAssembly simulator: the hardware-independent ArduinoCore-API (String, Print, Stream and
 * the Common.h prototypes) plus one Serial port. Pin functions exist and do nothing; there are no registers.
 */
#ifndef OPENPLC_WASM_SIM_ARDUINO_H
#define OPENPLC_WASM_SIM_ARDUINO_H

#include "api/ArduinoAPI.h"

#undef SERIAL
#undef DISPLAY

#define LED_BUILTIN 13
#define A0 54
#define A1 55
#define A2 56
#define A3 57
#define A4 58
#define A5 59
#define A6 60
#define A7 61
#define A8 62
#define A9 63
#define A10 64
#define A11 65
#define A12 66
#define A13 67
#define A14 68
#define A15 69

#ifdef __cplusplus
#include "api/HardwareSerial.h"

using namespace arduino;

/** The simulator's serial port: bytes the host delivers are read here, and writes go back to the host. */
class SimulatorSerial : public arduino::HardwareSerial {
public:
    void begin(unsigned long baud) override;
    void begin(unsigned long baud, uint16_t config) override;
    void end() override;
    int available(void) override;
    int peek(void) override;
    int read(void) override;
    void flush(void) override;
    size_t write(uint8_t byte) override;
    using arduino::Print::write;
    operator bool() override;
};

extern SimulatorSerial Serial;
#endif

#endif
