// Simulator HAL — derived from openplc-editor's
// resources/sources/hal/mega_due.cpp.
//
// Identical I/O wiring (digital + analog mappings against PINMASK_*)
// so the simulator's view of pin layout matches what the editor's
// Mega/Due board uses.  The PWM Controller code path is dropped:
// it pulls in AVR_PWM.h / SAMDUE_PWM.h, which arduino-cli on the
// compiler-service backend doesn't have installed (the editor
// installs those as user-level Arduino libraries; the centralised
// compiler-service ships only the arduino:avr core).  The simulator
// has no real PWM hardware anyway — the C-based PWM block isn't
// exercisable inside avr8js — so `set_hardware_pwm` becomes a no-op
// stub.  If we ever virtualise PWM, this is the file to revisit.

#include <stdlib.h>
extern "C" {
#include "openplc.h"
}
#include "Arduino.h"
#include "defines.h"

//Create the I/O pin masks
uint8_t pinMask_DIN[] = {PINMASK_DIN};
uint8_t pinMask_AIN[] = {PINMASK_AIN};
uint8_t pinMask_DOUT[] = {PINMASK_DOUT};
uint8_t pinMask_AOUT[] = {PINMASK_AOUT};

extern "C" uint8_t set_hardware_pwm(uint8_t, float, float); //this call is required for the C-based PWM block on the Editor

void hardwareInit()
{
    for (int i = 0; i < NUM_DISCRETE_INPUT; i++)
    {
		uint8_t pin = pinMask_DIN[i];
        pinMode(pin, INPUT);
    }

    for (int i = 0; i < NUM_ANALOG_INPUT; i++)
    {
		uint8_t pin = pinMask_AIN[i];
        pinMode(pin, INPUT);
    }

    for (int i = 0; i < NUM_DISCRETE_OUTPUT; i++)
    {
		uint8_t pin = pinMask_DOUT[i];
        pinMode(pin, OUTPUT);
    }

    for (int i = 0; i < NUM_ANALOG_OUTPUT; i++)
    {
		uint8_t pin = pinMask_AOUT[i];
        pinMode(pin, OUTPUT);
    }
}

// No real PWM hardware to drive inside the avr8js simulator — return
// 0 so any project using the C-based PWM block fails the soft check
// (matching the "channel unsupported" semantics) instead of crashing
// the link with an unresolved symbol.
uint8_t set_hardware_pwm(uint8_t /*ch*/, float /*freq*/, float /*duty*/)
{
    return 0;
}

void updateInputBuffers()
{
    for (int i = 0; i < NUM_DISCRETE_INPUT; i++)
    {
		uint8_t pin = pinMask_DIN[i];
        if (bool_input[i/8][i%8] != NULL)
            *bool_input[i/8][i%8] = digitalRead(pin);
    }

    for (int i = 0; i < NUM_ANALOG_INPUT; i++)
    {
		uint8_t pin = pinMask_AIN[i];
        if (int_input[i] != NULL)
            *int_input[i] = (analogRead(pin) * 64);
    }
}

void updateOutputBuffers()
{
    for (int i = 0; i < NUM_DISCRETE_OUTPUT; i++)
    {
		uint8_t pin = pinMask_DOUT[i];
        if (bool_output[i/8][i%8] != NULL)
            digitalWrite(pin, *bool_output[i/8][i%8]);
    }
    for (int i = 0; i < NUM_ANALOG_OUTPUT; i++)
    {
		uint8_t pin = pinMask_AOUT[i];
        if (int_output[i] != NULL)
            analogWrite(pin, (*int_output[i] / 256));
    }
}
