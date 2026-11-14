/**
 * Host interface of the WebAssembly simulator module (wasm32-wasip1, reactor).
 *
 * Imports, module "env":
 *   host_clock_us()                  simulated time in microseconds; the host advances it
 *   host_uart_write(data, length)    bytes the firmware sent on Serial
 *
 * Exports:
 *   sim_setup()                      runs the sketch's setup()
 *   sim_loop()                       runs the sketch's loop() once
 *   sim_uart_receive(byte)           delivers one byte to Serial
 *   sim_scan_period_us()             the base scan period setup() configured
 *
 * Time only moves when the host advances it, so delay() and delayMicroseconds() return at once.
 */
#include <Arduino.h>

extern "C" {
__attribute__((import_module("env"), import_name("host_clock_us"))) uint64_t host_clock_us(void);
__attribute__((import_module("env"), import_name("host_uart_write"))) void host_uart_write(const uint8_t *data,
                                                                                             uint32_t length);
}

extern unsigned long scan_cycle;

namespace {

const size_t RX_CAPACITY = 4096;
const size_t TX_CAPACITY = 1024;

uint8_t rx_buffer[RX_CAPACITY];
size_t rx_head = 0;
size_t rx_count = 0;

uint8_t tx_buffer[TX_CAPACITY];
size_t tx_count = 0;

void flush_tx()
{
    if (tx_count == 0) return;
    host_uart_write(tx_buffer, (uint32_t)tx_count);
    tx_count = 0;
}

} // namespace

SimulatorSerial Serial;

void SimulatorSerial::begin(unsigned long) {}
void SimulatorSerial::begin(unsigned long, uint16_t) {}
void SimulatorSerial::end() {}
int SimulatorSerial::available(void) { return (int)rx_count; }
int SimulatorSerial::peek(void) { return rx_count == 0 ? -1 : rx_buffer[rx_head]; }

int SimulatorSerial::read(void)
{
    if (rx_count == 0) return -1;
    uint8_t byte = rx_buffer[rx_head];
    rx_head = (rx_head + 1) % RX_CAPACITY;
    rx_count--;
    return byte;
}

void SimulatorSerial::flush(void) { flush_tx(); }

size_t SimulatorSerial::write(uint8_t byte)
{
    if (tx_count == TX_CAPACITY) flush_tx();
    tx_buffer[tx_count++] = byte;
    return 1;
}

SimulatorSerial::operator bool() { return true; }

extern "C" {

unsigned long millis(void) { return (unsigned long)(host_clock_us() / 1000); }
unsigned long micros(void) { return (unsigned long)host_clock_us(); }
void delay(unsigned long) {}
void delayMicroseconds(unsigned int) {}
void yield(void) {}

void pinMode(pin_size_t, PinMode) {}
void digitalWrite(pin_size_t, PinStatus) {}
PinStatus digitalRead(pin_size_t) { return LOW; }
int analogRead(pin_size_t) { return 0; }
void analogReference(uint8_t) {}
void analogWrite(pin_size_t, int) {}
unsigned long pulseIn(pin_size_t, uint8_t, unsigned long) { return 0; }
unsigned long pulseInLong(pin_size_t, uint8_t, unsigned long) { return 0; }
void shiftOut(pin_size_t, pin_size_t, BitOrder, uint8_t) {}
uint8_t shiftIn(pin_size_t, pin_size_t, BitOrder) { return 0; }
void attachInterrupt(pin_size_t, voidFuncPtr, PinStatus) {}
void attachInterruptParam(pin_size_t, voidFuncPtrParam, PinStatus, void *) {}
void detachInterrupt(pin_size_t) {}

__attribute__((export_name("sim_setup"))) void sim_setup(void)
{
    setup();
    flush_tx();
}

__attribute__((export_name("sim_loop"))) void sim_loop(void)
{
    loop();
    flush_tx();
}

__attribute__((export_name("sim_uart_receive"))) void sim_uart_receive(uint8_t byte)
{
    if (rx_count == RX_CAPACITY) return;
    rx_buffer[(rx_head + rx_count) % RX_CAPACITY] = byte;
    rx_count++;
}

__attribute__((export_name("sim_scan_period_us"))) uint32_t sim_scan_period_us(void)
{
    return (uint32_t)scan_cycle;
}

} // extern "C"

void tone(uint8_t, unsigned int, unsigned long) {}
void noTone(uint8_t) {}
