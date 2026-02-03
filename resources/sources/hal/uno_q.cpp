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
 * The following stub functions are required because the IEC standard library
 * headers declare extern functions for various hardware modules. These
 * declarations create symbol references that must be resolved at load time.
 *
 * On Zephyr LLEXT, unresolved symbols cause the module loader to fail.
 * These stubs provide safe no-op implementations that allow the code to load.
 * =============================================================================
 */

extern "C" {

// ADC/Jaguar stubs
uint8_t ADC_configure_channel(uint8_t adc_ch, uint8_t adc_type) { return 0; }

// Industrial Shields BAS stubs
int basGet1WbTemp(uint8_t stack, uint8_t channel, float *val) { if(val) *val = 0; return -1; }
int basGetDryContacts(uint8_t stack, uint8_t *val) { if(val) *val = 0; return -1; }
int basGetUniversalIn(uint8_t stack, uint8_t channel, float *val) { if(val) *val = 0; return -1; }
int basSet0_10Vout(uint8_t stack, uint8_t channel, float val) { return -1; }
int basSetTriacs(uint8_t stack, uint8_t val) { return -1; }

// Cloud stubs
void cloud_add_bool(const char* name, uint8_t* var) {}
void cloud_add_float(const char* name, float* var) {}
void cloud_add_int(const char* name, int* var) {}
void cloud_begin(const char* thing_id, const char* ssid, const char* pass) {}
void cloud_update(void) {}

// MQTT stubs
int connect_mqtt(const char* broker, int port, const char* client_id) { return -1; }
int connect_mqtt_auth(const char* broker, int port, const char* client_id, const char* user, const char* pass) { return -1; }
void mqtt_disconnect(void) {}
void mqtt_loop(void) {}
int mqtt_receive(char* topic, int topic_len, char* payload, int payload_len) { return -1; }
int mqtt_send(const char* topic, const char* payload) { return -1; }
int mqtt_subscribe(const char* topic) { return -1; }
int mqtt_unsubscribe(const char* topic) { return -1; }

// Digital I/O module stubs
uint16_t digIn16Get(uint8_t addr) { return 0; }
void digIn16Init(uint8_t addr) {}
uint8_t digIn8Get(uint8_t addr) { return 0; }
void digIn8Init(uint8_t addr) {}
void mosfet8Init(uint8_t addr) {}
void mosfets8Set(uint8_t addr, uint8_t val) {}
void relay16Init(uint8_t addr) {}
void relay16Set(uint8_t addr, uint16_t val) {}
void relay8Init(uint8_t addr) {}
void relays8Set(uint8_t addr, uint8_t val) {}

// Industrial Shields HOME stubs
int homeGet1WbTemp(uint8_t stack, uint8_t channel, float *val) { if(val) *val = 0; return -1; }
int homeGetADC(uint8_t stack, uint8_t channel, float *val) { if(val) *val = 0; return -1; }
int homeGetOpto(uint8_t stack, uint8_t *val) { if(val) *val = 0; return -1; }
int homeSet0_10Vout(uint8_t stack, uint8_t channel, float val) { return -1; }
int homeSetOD(uint8_t stack, uint8_t val) { return -1; }
int homeSetRelays(uint8_t stack, uint8_t val) { return -1; }

// Industrial Shields IND stubs
int indGet0_10Vin(uint8_t stack, uint8_t channel, float *val) { if(val) *val = 0; return -1; }
int indGet1WbTemp(uint8_t stack, uint8_t channel, float *val) { if(val) *val = 0; return -1; }
int indGet4_20mAin(uint8_t stack, uint8_t channel, float *val) { if(val) *val = 0; return -1; }
int indGetOptoInputs(uint8_t stack, uint8_t *val) { if(val) *val = 0; return -1; }
int indSet0_10Vout(uint8_t stack, uint8_t channel, float val) { return -1; }
int indSet4_20mAout(uint8_t stack, uint8_t channel, float val) { return -1; }
int indSetLeds(uint8_t stack, uint8_t val) { return -1; }
int indSetPWMout(uint8_t stack, uint8_t channel, float val) { return -1; }

// DS18B20 temperature sensor stubs
void* init_ds18b20(uint8_t pin) { return nullptr; }
float read_ds18b20(void* sensor) { return 0.0f; }
void request_ds18b20_temperatures(void* sensor) {}

// CAN bus stubs
void* init_arduinocan(uint8_t pin) { return nullptr; }
int read_arduinocan(void* can, uint32_t* id, uint8_t* data, uint8_t* len) { return -1; }
int write_arduinocan(void* can, uint32_t id, uint8_t* data, uint8_t len) { return -1; }
int write_arduinocan_word(void* can, uint32_t id, uint16_t word) { return -1; }
void* init_stm32can(uint8_t pin) { return nullptr; }
int read_stm32can(void* can, uint32_t* id, uint8_t* data, uint8_t* len) { return -1; }
int write_stm32can(void* can, uint32_t id, uint8_t* data, uint8_t len) { return -1; }

// P1AM stubs
void p1am_init(void) {}
int p1am_readAnalog(uint8_t slot, uint8_t channel) { return 0; }
uint32_t p1am_readDiscrete(uint8_t slot, uint8_t channel) { return 0; }
void p1am_writeDiscrete(uint32_t val, uint8_t slot, uint8_t channel) {}

// R4I4 module stubs
uint8_t r4i4GetACInputs(uint8_t addr) { return 0; }
uint8_t r4i4GetButton(uint8_t addr) { return 0; }
uint8_t r4i4GetOptoInputs(uint8_t addr) { return 0; }
float r4i4GetPWMInFill(uint8_t addr, uint8_t channel) { return 0.0f; }
float r4i4GetPWMInFreq(uint8_t addr, uint8_t channel) { return 0.0f; }
void r4i4SetRelays(uint8_t addr, uint8_t val) {}

// RTD temperature sensor stubs
float rtdGetTemp(uint8_t addr, uint8_t channel) { return 0.0f; }

// PWM stubs
void set_hardware_pwm(uint8_t pin, uint16_t freq, uint8_t duty) {}

// stdio stubs (fwrite used by fprintf in __iec_error)
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream) {
    // Use printk for error output on Zephyr
    if (stream != nullptr && size > 0 && nmemb > 0) {
        printk("%.*s", (int)(size * nmemb), (const char *)ptr);
    }
    return nmemb;
}

} // extern "C"
