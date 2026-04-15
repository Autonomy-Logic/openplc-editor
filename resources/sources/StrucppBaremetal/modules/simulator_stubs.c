/*
 * Simulator stub implementations for hardware-dependent function blocks.
 *
 * When compiling for the AVR simulator (SIMULATOR_MODE), this file provides
 * no-op implementations of every extern "C" function from the hardware module
 * files (p1am, mqtt, ds18b20, arduinocan, stm32can, sm_cards, arduino_cloud)
 * plus the TCP communication functions from MatIEC.
 *
 * No platform-specific headers are needed — only stdint.h and stddef.h.
 */

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

/* ========================================================================
 * P1AM module stubs (p1am.c)
 * ======================================================================== */

uint8_t p1am_init() {
    return 0;
}

void p1am_writeDiscrete(uint32_t data, uint8_t slot, uint8_t channel) {
    (void)data; (void)slot; (void)channel;
}

uint32_t p1am_readDiscrete(uint8_t slot, uint8_t channel) {
    (void)slot; (void)channel;
    return 0;
}

uint16_t p1am_readAnalog(uint8_t slot, uint8_t channel) {
    (void)slot; (void)channel;
    return 0;
}

/* ========================================================================
 * MQTT module stubs (mqtt.c)
 * ======================================================================== */

uint8_t connect_mqtt(char *broker, uint16_t port) {
    (void)broker; (void)port;
    return 0;
}

uint8_t connect_mqtt_auth(char *broker, uint16_t port, char *user, char *password) {
    (void)broker; (void)port; (void)user; (void)password;
    return 0;
}

uint8_t mqtt_send(char *topic, char *message) {
    (void)topic; (void)message;
    return 0;
}

uint8_t mqtt_receive(char *topic, char *message) {
    (void)topic; (void)message;
    return 0;
}

uint8_t mqtt_subscribe(char *topic) {
    (void)topic;
    return 0;
}

uint8_t mqtt_unsubscribe(char *topic) {
    (void)topic;
    return 0;
}

uint8_t mqtt_disconnect() {
    return 0;
}

void mqtt_loop() {
}

/* ========================================================================
 * DS18B20 module stubs (ds18b20.c)
 * ======================================================================== */

void *init_ds18b20(uint8_t pin) {
    (void)pin;
    return NULL;
}

void request_ds18b20_temperatures(void *class_pointer) {
    (void)class_pointer;
}

float read_ds18b20(void *class_pointer, uint8_t index) {
    (void)class_pointer; (void)index;
    return 0.0f;
}

/* ========================================================================
 * Arduino CAN module stubs (arduinocan.c)
 * ======================================================================== */

void *init_arduinocan(uint8_t pin_en, int baudrate) {
    (void)pin_en; (void)baudrate;
    return NULL;
}

uint8_t write_arduinocan(uint32_t id, uint8_t d0, uint8_t d1, uint8_t d2,
                         uint8_t d3, uint8_t d4, uint8_t d5, uint8_t d6, uint8_t d7) {
    (void)id; (void)d0; (void)d1; (void)d2;
    (void)d3; (void)d4; (void)d5; (void)d6; (void)d7;
    return 0;
}

uint8_t write_arduinocan_word(uint32_t id, uint64_t data) {
    (void)id; (void)data;
    return 0;
}

uint64_t read_arduinocan() {
    return 0;
}

/* ========================================================================
 * STM32 CAN module stubs (stm32can.c)
 * ======================================================================== */

uint8_t init_stm32can(int baudrate) {
    (void)baudrate;
    return 0;
}

uint8_t write_stm32can(uint8_t ch, uint32_t id, uint8_t d0, uint8_t d1,
                       uint8_t d2, uint8_t d3, uint8_t d4, uint8_t d5,
                       uint8_t d6, uint8_t d7) {
    (void)ch; (void)id; (void)d0; (void)d1;
    (void)d2; (void)d3; (void)d4; (void)d5;
    (void)d6; (void)d7;
    return 0;
}

uint8_t read_stm32can(uint32_t *id, uint8_t *d0, uint8_t *d1, uint8_t *d2,
                      uint8_t *d3, uint8_t *d4, uint8_t *d5, uint8_t *d6,
                      uint8_t *d7) {
    (void)id; (void)d0; (void)d1; (void)d2;
    (void)d3; (void)d4; (void)d5; (void)d6; (void)d7;
    return 0;
}

/* ========================================================================
 * Sequent Microsystems cards stubs (sm_cards.c)
 * ======================================================================== */

/* 8-Relay Card */
int relay8Init(int stack) {
    (void)stack;
    return 0;
}

int relays8Set(uint8_t stack, uint8_t val) {
    (void)stack; (void)val;
    return 0;
}

/* 16-Relay Card */
int relay16Init(int stack) {
    (void)stack;
    return 0;
}

int relay16Set(uint8_t stack, uint16_t val) {
    (void)stack; (void)val;
    return 0;
}

/* 8 Digital Inputs Card */
int digIn8Init(int stack) {
    (void)stack;
    return 0;
}

int digIn8Get(uint8_t stack, uint8_t *val) {
    (void)stack; (void)val;
    return 0;
}

/* 16 Digital Inputs Card */
int digIn16Init(int stack) {
    (void)stack;
    return 0;
}

int digIn16Get(uint8_t stack, uint16_t *val) {
    (void)stack; (void)val;
    return 0;
}

/* 4-Relay 4-Input Card (r4i4) */
int r4i4SetRelays(uint8_t stack, uint8_t value) {
    (void)stack; (void)value;
    return 0;
}

int r4i4GetOptoInputs(uint8_t stack, uint8_t *val) {
    (void)stack; (void)val;
    return 0;
}

int r4i4GetACInputs(uint8_t stack, uint8_t *val) {
    (void)stack; (void)val;
    return 0;
}

int r4i4GetButton(uint8_t stack, uint8_t *button) {
    (void)stack; (void)button;
    return 0;
}

int r4i4GetPWMInFill(uint8_t stack, uint8_t channel, uint16_t *value) {
    (void)stack; (void)channel; (void)value;
    return 0;
}

int r4i4GetPWMInFreq(uint8_t stack, uint8_t channel, uint16_t *value) {
    (void)stack; (void)channel; (void)value;
    return 0;
}

/* RTD Temperature Card */
int rtdGetTemp(uint8_t stack, uint8_t channel, float *value) {
    (void)stack; (void)channel; (void)value;
    return 0;
}

/* Industrial Automation Card */
int indSetLeds(uint8_t stack, uint8_t value) {
    (void)stack; (void)value;
    return 0;
}

int indGetOptoInputs(uint8_t stack, uint8_t *val) {
    (void)stack; (void)val;
    return 0;
}

int indGet0_10Vin(uint8_t stack, uint8_t channel, float *val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

int indGet4_20mAin(uint8_t stack, uint8_t channel, float *val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

int indGet1WbTemp(uint8_t stack, uint8_t channel, float *val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

int indSet0_10Vout(uint8_t stack, uint8_t channel, float val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

int indSet4_20mAout(uint8_t stack, uint8_t channel, float val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

int indSetPWMout(uint8_t stack, uint8_t channel, float val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

/* Building Automation Card */
int basSetLeds(uint8_t stack, uint8_t value) {
    (void)stack; (void)value;
    return 0;
}

int basSetTriacs(uint8_t stack, uint8_t value) {
    (void)stack; (void)value;
    return 0;
}

int basSet0_10Vout(uint8_t stack, uint8_t channel, float val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

int basGetDryContacts(uint8_t stack, uint8_t *val) {
    (void)stack; (void)val;
    return 0;
}

int basGetUniversalIn(uint8_t stack, uint8_t channel, uint8_t type, float *val) {
    (void)stack; (void)channel; (void)type; (void)val;
    return 0;
}

int basGet1WbTemp(uint8_t stack, uint8_t channel, float *val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

/* Home Automation Card */
int homeSetRelays(uint8_t stack, uint8_t value) {
    (void)stack; (void)value;
    return 0;
}

int homeSet0_10Vout(uint8_t stack, uint8_t channel, float val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

int homeSetOD(uint8_t stack, uint8_t channel, float val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

int homeGetOpto(uint8_t stack, uint8_t *val) {
    (void)stack; (void)val;
    return 0;
}

int homeGetADC(uint8_t stack, uint8_t channel, float *val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

int homeGet1WbTemp(uint8_t stack, uint8_t channel, float *val) {
    (void)stack; (void)channel; (void)val;
    return 0;
}

/* 8-MOSFET Card */
int mosfet8Init(int stack) {
    (void)stack;
    return 0;
}

int mosfets8Set(uint8_t stack, uint8_t val) {
    (void)stack; (void)val;
    return 0;
}

/* ========================================================================
 * Arduino Cloud module stubs (arduino_cloud.c)
 * ======================================================================== */

void cloud_begin(char *thing_id, char *str_ssid, char *str_pass) {
    (void)thing_id; (void)str_ssid; (void)str_pass;
}

void cloud_add_bool(char *var_name, int *bool_var) {
    (void)var_name; (void)bool_var;
}

void cloud_add_int(char *var_name, int *int_var) {
    (void)var_name; (void)int_var;
}

void cloud_add_float(char *var_name, float *float_var) {
    (void)var_name; (void)float_var;
}

void cloud_update() {
}

/* ========================================================================
 * TCP communication stubs (MatIEC communication.h)
 * ======================================================================== */

int connect_to_tcp_server(uint8_t *ip_address, uint16_t port, int method) {
    (void)ip_address; (void)port; (void)method;
    return -1;
}

int send_tcp_message(uint8_t *msg, size_t msg_size, int socket_id) {
    (void)msg; (void)msg_size; (void)socket_id;
    return 0;
}

int receive_tcp_message(uint8_t *msg_buffer, size_t buffer_size, int socket_id) {
    (void)msg_buffer; (void)buffer_size; (void)socket_id;
    return 0;
}

int close_tcp_connection(int socket_id) {
    (void)socket_id;
    return 0;
}

#ifdef __cplusplus
}
#endif
