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
 * The following stub functions are required because arduino_lib_FB.h and
 * stm32.h declare extern functions that must be resolved at load time.
 *
 * Note: Stubs for P1AM, MQTT, SM_CARDS, Jaguar, and SL-RP4 are NOT needed
 * because those headers are conditionally included via USE_*_BLOCKS macros.
 * =============================================================================
 */

extern "C" {

// DS18B20 temperature sensor stubs (arduino_lib_FB.h)
void* init_ds18b20(uint8_t pin) { return nullptr; }
float read_ds18b20(void* sensor, uint8_t index) { return 0.0f; }
void request_ds18b20_temperatures(void* sensor) {}

// Cloud stubs (arduino_lib_FB.h)
void cloud_add_bool(char* name, int* var) {}
void cloud_add_float(char* name, float* var) {}
void cloud_add_int(char* name, int* var) {}
void cloud_begin(char* thing_id, char* ssid, char* pass) {}
void cloud_update(void) {}

// PWM stubs (arduino_lib_FB.h)
uint8_t set_hardware_pwm(uint8_t pin, float freq, float duty) { return 0; }

// Arduino CAN stubs (arduino_lib_FB.h)
void* init_arduinocan(uint8_t pin, int baud) { return nullptr; }
bool write_arduinocan(uint32_t id, uint8_t d0, uint8_t d1, uint8_t d2, uint8_t d3,
                      uint8_t d4, uint8_t d5, uint8_t d6, uint8_t d7) { return false; }
bool write_arduinocan_word(uint32_t id, uint64_t data) { return false; }
uint64_t read_arduinocan() { return 0; }

// STM32 CAN stubs (stm32.h)
uint8_t init_stm32can(int baud) { return 0; }
uint8_t write_stm32can(uint8_t len, uint32_t id, uint8_t d0, uint8_t d1, uint8_t d2,
                       uint8_t d3, uint8_t d4, uint8_t d5, uint8_t d6, uint8_t d7) { return 0; }
uint8_t read_stm32can(uint32_t* id, uint8_t* d0, uint8_t* d1, uint8_t* d2, uint8_t* d3,
                      uint8_t* d4, uint8_t* d5, uint8_t* d6, uint8_t* d7) { return 0; }

// stdio stubs (fwrite used by fprintf in __iec_error)
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream) {
    if (stream != nullptr && size > 0 && nmemb > 0) {
        printk("%.*s", (int)(size * nmemb), (const char *)ptr);
    }
    return nmemb;
}

} // extern "C"
