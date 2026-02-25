#include <stdlib.h>
#include <stdio.h>
extern "C" {
#include "openplc.h"
}
#include "Arduino.h"
#include "../examples/Baremetal/defines.h"

//OpenPLC HAL for Arduino Uno Q (Zephyr-based)

/******************PINOUT CONFIGURATION*******************
Digital In: 2, 3, 4, 5, 6           (%IX0.0 - %IX0.4)
Digital Out: 7, 8, 12, 13           (%QX0.0 - %QX0.3)
Analog In: A0, A1, A2, A3, A4, A5   (%IW0 - %IW5)
Analog Out: 9, 10, 11               (%QW0 - %QW2)
**********************************************************/

//Create the I/O pin masks
uint8_t pinMask_DIN[] = {PINMASK_DIN};
uint8_t pinMask_AIN[] = {PINMASK_AIN};
uint8_t pinMask_DOUT[] = {PINMASK_DOUT};
uint8_t pinMask_AOUT[] = {PINMASK_AOUT};


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

/*
 * =============================================================================
 * STUB IMPLEMENTATIONS FOR ZEPHYR LLEXT
 * =============================================================================
 * Most function block headers (DS18B20, Cloud, CAN, P1AM, MQTT, etc.) are now
 * conditionally included via USE_*_BLOCK macros, so stubs are not needed.
 * PWM_CONTROLLER is always included (no USE_PWM_BLOCK guard), so it needs a stub.
 * fwrite is required for __iec_error output redirection.
 * =============================================================================
 */

extern "C" {

// PWM stub (arduino_lib_FB.h - always included, no USE_*_BLOCK guard)
uint8_t set_hardware_pwm(uint8_t pin, float freq, float duty) { return 0; }

// stdio stubs (fwrite used by fprintf in __iec_error)
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream) {
    if (stream != nullptr && size > 0 && nmemb > 0) {
        printk("%.*s", (int)(size * nmemb), (const char *)ptr);
    }
    return nmemb;
}

} // extern "C"
