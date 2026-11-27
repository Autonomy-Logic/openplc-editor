// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#include "modbus_master_rtu.h"

#if MB_MASTER_ENABLED && MB_MASTER_RTU_ENABLED

#include "modbus_crc.h"
#include "modbus_master_util.h"
#include "modbus_rs485.h"

namespace {

/** Largest RTU frame the master sends or accepts: slave id, PDU and CRC. */
const uint16_t FRAME_MAX = MB_MASTER_PDU_MAX + 3;

/** Inter-frame silence above 19200 bd, in microseconds, fixed by the Modbus serial line specification. */
const uint32_t T35_FAST_US = 1750;

/** Progress of a bus through one request. */
enum BusState : uint8_t
{
    /** The bus never polls: its UART is reserved or its line settings cannot be applied. */
    BUS_OFF,
    /** Nothing in flight; the line is drained. */
    BUS_IDLE,
    /** A request waits for an idle line. */
    BUS_PENDING,
    /** The request is being handed to the UART with the RS-485 line on transmit. */
    BUS_SEND,
    /** The request has left; the response is being received. */
    BUS_AWAIT
};

/** One RTU bus: its state, line timing, the request in flight and its frames. */
struct Bus
{
    uint8_t state;
    bool begun;
    /** No byte has crossed the line for 3.5 characters since `activity_us`. */
    bool quiet;
    /** The whole response is in and its CRC is valid; it is accepted after 3.5 characters of silence. */
    bool complete;
    uint16_t tx_len;
    uint16_t tx_pos;
    uint16_t rx_len;
    /** Length of the normal response to the request in flight. */
    uint16_t expected;
    uint32_t char_us;
    uint32_t t35_us;
    /** When the last byte was seen on the line or the last request left. */
    uint32_t activity_us;
    /** When the UART last started from idle, and how many characters it was handed since. */
    uint32_t tx_start_us;
    uint32_t tx_chars;
    /** When the request was taken (pending) or when it had left (awaiting). */
    uint32_t since_ms;
    mb_master_request_t req;
    uint8_t tx[FRAME_MAX];
    uint8_t rx[FRAME_MAX];
};

Bus g_buses[MB_MASTER_BUS_COUNT];

/** Code of a line setting: data bits, parity (MB_PARITY_*) and stop bits. */
constexpr uint16_t line(uint8_t data_bits, uint8_t parity, uint8_t stop_bits)
{
    return (uint16_t)(data_bits * 100u + parity * 10u + stop_bits);
}

/** Begin `port` at `baud` with the core's line setting `config`; false when the port takes no line setting. */
template <typename Port, typename Config>
auto begin_with(Port *port, uint32_t baud, Config config, int) -> decltype((void)port->begin(baud, config), bool())
{
    port->begin(baud, config);
    return true;
}

/** The port takes no line setting. */
template <typename Port, typename Config>
bool begin_with(Port *, uint32_t, Config, long)
{
    return false;
}

/** Begin `port` with the bus's baud rate, data bits, parity and stop bits; false when the core cannot apply them. */
template <typename Port>
bool begin_line(Port *port, const mb_master_bus_t &bus)
{
    switch (line(bus.data_bits, bus.parity, bus.stop_bits))
    {
        case line(8, MB_PARITY_N, 1):
#if defined(SERIAL_8N1) || defined(ARDUINO_ARCH_ESP8266)
            if (begin_with(port, bus.baud, SERIAL_8N1, 0))
                return true;
#endif
            port->begin(bus.baud);
            return true;
#if defined(SERIAL_8N2) || defined(ARDUINO_ARCH_ESP8266)
        case line(8, MB_PARITY_N, 2):
            return begin_with(port, bus.baud, SERIAL_8N2, 0);
#endif
#if defined(SERIAL_8E1) || defined(ARDUINO_ARCH_ESP8266)
        case line(8, MB_PARITY_E, 1):
            return begin_with(port, bus.baud, SERIAL_8E1, 0);
#endif
#if defined(SERIAL_8E2) || defined(ARDUINO_ARCH_ESP8266)
        case line(8, MB_PARITY_E, 2):
            return begin_with(port, bus.baud, SERIAL_8E2, 0);
#endif
#if defined(SERIAL_8O1) || defined(ARDUINO_ARCH_ESP8266)
        case line(8, MB_PARITY_O, 1):
            return begin_with(port, bus.baud, SERIAL_8O1, 0);
#endif
#if defined(SERIAL_8O2) || defined(ARDUINO_ARCH_ESP8266)
        case line(8, MB_PARITY_O, 2):
            return begin_with(port, bus.baud, SERIAL_8O2, 0);
#endif
#if defined(SERIAL_7N1) || defined(ARDUINO_ARCH_ESP8266)
        case line(7, MB_PARITY_N, 1):
            return begin_with(port, bus.baud, SERIAL_7N1, 0);
#endif
#if defined(SERIAL_7N2) || defined(ARDUINO_ARCH_ESP8266)
        case line(7, MB_PARITY_N, 2):
            return begin_with(port, bus.baud, SERIAL_7N2, 0);
#endif
#if defined(SERIAL_7E1) || defined(ARDUINO_ARCH_ESP8266)
        case line(7, MB_PARITY_E, 1):
            return begin_with(port, bus.baud, SERIAL_7E1, 0);
#endif
#if defined(SERIAL_7E2) || defined(ARDUINO_ARCH_ESP8266)
        case line(7, MB_PARITY_E, 2):
            return begin_with(port, bus.baud, SERIAL_7E2, 0);
#endif
#if defined(SERIAL_7O1) || defined(ARDUINO_ARCH_ESP8266)
        case line(7, MB_PARITY_O, 1):
            return begin_with(port, bus.baud, SERIAL_7O1, 0);
#endif
#if defined(SERIAL_7O2) || defined(ARDUINO_ARCH_ESP8266)
        case line(7, MB_PARITY_O, 2):
            return begin_with(port, bus.baud, SERIAL_7O2, 0);
#endif
        default:
            return false;
    }
}

/** Bytes `port` takes now without waiting, as its availableForWrite() reports them. */
template <typename Port>
auto room_of(Port *port, int) -> decltype(port->availableForWrite())
{
    return port->availableForWrite();
}

/** The port reports no transmit room. */
template <typename Port>
int room_of(Port *, long)
{
    return 0;
}

#if defined(ARDUINO_ARCH_SAM)

/** Begin a bus's UART through its USART object, which alone takes a line setting on this core. */
bool begin_uart(const mb_master_bus_t &bus)
{
    if (bus.uart == &Serial1)
        return begin_line(&Serial1, bus);
    if (bus.uart == &Serial2)
        return begin_line(&Serial2, bus);
    if (bus.uart == &Serial3)
        return begin_line(&Serial3, bus);
    return begin_line(bus.uart, bus);
}

/** Transmit room of a bus's UART through its USART object, which alone reports it on this core. */
int tx_room(HardwareSerial *uart)
{
    if (uart == &Serial1)
        return Serial1.availableForWrite();
    if (uart == &Serial2)
        return Serial2.availableForWrite();
    if (uart == &Serial3)
        return Serial3.availableForWrite();
    return room_of(uart, 0);
}

#else

/** Begin a bus's UART with its line settings. */
bool begin_uart(const mb_master_bus_t &bus)
{
    return begin_line(bus.uart, bus);
}

/** Transmit room of a bus's UART. */
int tx_room(HardwareSerial *uart)
{
    return room_of(uart, 0);
}

#endif

/** Whether `uart` and `port` are the same object, whatever the type the core gives `port`. */
template <typename Port>
bool same_port(const HardwareSerial *uart, const Port *port)
{
    return static_cast<const void *>(uart) == static_cast<const void *>(port);
}

/** Whether `uart` belongs to the debugger or to the Modbus RTU server. */
bool reserved(const HardwareSerial *uart)
{
    bool taken = false;
#ifdef DEBUGGER_ENABLED
    taken = taken || same_port(uart, &DEBUG_IFACE);
#endif
#if defined(MODBUS_ENABLED) && defined(MBSERIAL)
    taken = taken || same_port(uart, &MBSERIAL_IFACE);
#endif
    (void)uart;
    return taken;
}

/** Whether the line has been silent for 3.5 characters; latched until the next byte or request. */
bool line_quiet(Bus &bus)
{
    if (!bus.quiet && (uint32_t)((uint32_t)micros() - bus.activity_us) >= bus.t35_us)
        bus.quiet = true;
    return bus.quiet;
}

/** A byte crossed the line, or a request left, now. */
void line_active(Bus &bus)
{
    bus.activity_us = (uint32_t)micros();
    bus.quiet = false;
}

/** Read and discard what the line holds, at most one buffer. */
void discard(Bus &bus, HardwareSerial *uart)
{
    for (uint16_t budget = FRAME_MAX; budget > 0 && uart->available() > 0; budget--)
    {
        if (uart->read() < 0)
            break;
        line_active(bus);
    }
}

/** End the request in flight: the bus goes idle and its receive state is cleared. */
void finish(Bus &bus)
{
    bus.state = BUS_IDLE;
    bus.rx_len = 0;
    bus.complete = false;
}

/** The request in flight failed: one failed poll. */
void poll_failed(Bus &bus)
{
    finish(bus);
    mb_master_fail(&bus.req);
}

/** Return the bus's RS-485 line to receive. */
void release_line(uint16_t b)
{
    mb_rs485_pin(MB_MASTER_BUSES[b].rs485_pin, false);
    mb_rs485_board(MB_MASTER_BUSES[b].uart, false);
}

/** Take the next request due on bus `b`, framed with its slave id and CRC; it waits for an idle line. */
void take_request(uint16_t b)
{
    Bus &bus = g_buses[b];
    const uint16_t pdu_len = mb_master_next_request(MB_MASTER_RTU, b, (uint32_t)millis(), &bus.req, &bus.tx[1]);
    if (pdu_len == 0)
        return;
    const uint16_t response_pdu = mb_master_response_pdu_len(&bus.req);
    if (response_pdu == 0)
    {
        mb_master_fail(&bus.req);
        return;
    }
    bus.tx[0] = bus.req.unit;
    const uint16_t crc = mb_crc16(bus.tx, (uint16_t)(pdu_len + 1));
    put16(&bus.tx[pdu_len + 1], crc);
    bus.tx_len = (uint16_t)(pdu_len + 3);
    bus.tx_pos = 0;
    bus.expected = (uint16_t)(response_pdu + 3);
    bus.since_ms = (uint32_t)millis();
    bus.state = BUS_PENDING;
}

/** Hand the UART what it takes now without waiting. A UART that reports no room before the first byte has
 *  no transmit buffer to report, and takes the whole request in one write. */
void feed(uint16_t b)
{
    Bus &bus = g_buses[b];
    HardwareSerial *const uart = MB_MASTER_BUSES[b].uart;
    while (bus.tx_pos < bus.tx_len)
    {
        const uint16_t left = (uint16_t)(bus.tx_len - bus.tx_pos);
        int room = tx_room(uart);
        if (room <= 0)
        {
            if (bus.tx_pos != 0)
                return;
            room = left;
        }
        const uint16_t count = (uint16_t)room < left ? (uint16_t)room : left;
        const uint32_t now = (uint32_t)micros();
        if ((uint32_t)(now - bus.tx_start_us) >= bus.tx_chars * bus.char_us)
        {
            bus.tx_start_us = now;
            bus.tx_chars = 0;
        }
        const size_t written = uart->write(&bus.tx[bus.tx_pos], count);
        if (written == 0)
        {
            release_line(b);
            line_active(bus);
            poll_failed(bus);
            return;
        }
        bus.tx_chars += (uint32_t)written;
        bus.tx_pos = (uint16_t)(bus.tx_pos + written);
    }
}

/** Whether every character handed to the UART has left: their time on the line at the bus's baud rate, plus
 *  one character and 1/32 of the frame for clock error. */
bool tx_done(const Bus &bus)
{
    const uint32_t frame_us = bus.tx_chars * bus.char_us;
    return (uint32_t)((uint32_t)micros() - bus.tx_start_us) >= frame_us + bus.char_us + frame_us / 32u;
}

/** Whether bytes on the line now cannot be the response: the request is on the line or ended less than 3.5
 *  characters ago, by the estimated end less 1/32 of the frame for clock error. Echoed request bytes fall here. */
bool echo_window(const Bus &bus)
{
    const uint32_t frame_us = bus.tx_chars * bus.char_us;
    return (uint32_t)((uint32_t)micros() - bus.tx_start_us) < frame_us - frame_us / 32u + bus.t35_us;
}

/** Start sending the pending request on an idle line: the RS-485 line goes to transmit before the first byte. */
void start_send(uint16_t b)
{
    Bus &bus = g_buses[b];
    mb_rs485_pin(MB_MASTER_BUSES[b].rs485_pin, true);
    mb_rs485_board(MB_MASTER_BUSES[b].uart, true);
    bus.tx_start_us = (uint32_t)micros();
    bus.tx_chars = 0;
    bus.state = BUS_SEND;
    feed(b);
}

/** Whether the bytes received so far can still be the normal response: slave id, function code, byte count
 *  and, once the frame is whole, its CRC. Marks the frame complete when it is. */
bool response_so_far(Bus &bus)
{
    const uint16_t last = (uint16_t)(bus.rx_len - 1);
    const uint8_t value = bus.rx[last];
    if (last == 0)
        return value == bus.req.unit;
    if (last == 1)
        return value == bus.req.fc;
    if (last == 2 && bus.req.fc >= MB_FC_READ_COILS && bus.req.fc <= MB_FC_READ_INPUT_REGS &&
        value != bus.expected - 5)
        return false;
    if (bus.rx_len < bus.expected)
        return true;
    const uint16_t crc = mb_crc16(bus.rx, (uint16_t)(bus.expected - 2));
    if (get16(&bus.rx[bus.expected - 2]) != crc)
        return false;
    bus.complete = true;
    return true;
}

/** Take at most one buffer of the response; fail on a byte that cannot belong to it or on the timeout, and
 *  hand a whole frame to the core once the line has been silent for 3.5 characters. Inside the echo window the
 *  buffer is discarded instead. */
void receive(uint16_t b)
{
    Bus &bus = g_buses[b];
    HardwareSerial *const uart = MB_MASTER_BUSES[b].uart;
    if (echo_window(bus))
    {
        discard(bus, uart);
        return;
    }
    for (uint16_t budget = FRAME_MAX; budget > 0 && uart->available() > 0; budget--)
    {
        const int value = uart->read();
        if (value < 0)
            break;
        line_active(bus);
        if (bus.complete || bus.rx_len >= bus.expected)
        {
            poll_failed(bus);
            return;
        }
        bus.rx[bus.rx_len++] = (uint8_t)value;
        if (!response_so_far(bus))
        {
            poll_failed(bus);
            return;
        }
    }

    if (bus.complete)
    {
        if (line_quiet(bus))
        {
            finish(bus);
            mb_master_accept(&bus.req, &bus.rx[1], (uint16_t)(bus.expected - 3));
        }
        return;
    }
    if ((uint32_t)((uint32_t)millis() - bus.since_ms) >= MB_MASTER_BUSES[b].timeout_ms)
        poll_failed(bus);
}

/** One pass over bus `b`. */
void service(uint16_t b)
{
    Bus &bus = g_buses[b];
    HardwareSerial *const uart = MB_MASTER_BUSES[b].uart;

    if (bus.state == BUS_IDLE)
    {
        discard(bus, uart);
        line_quiet(bus);
        take_request(b);
    }
    else if (bus.state == BUS_PENDING)
    {
        discard(bus, uart);
    }

    if (bus.state == BUS_PENDING)
    {
        if (line_quiet(bus))
            start_send(b);
        else if ((uint32_t)((uint32_t)millis() - bus.since_ms) >= MB_MASTER_BUSES[b].timeout_ms)
            poll_failed(bus);
        return;
    }

    if (bus.state == BUS_SEND)
    {
        if (echo_window(bus))
            discard(bus, uart);
        feed(b);
        if (bus.state == BUS_SEND && bus.tx_pos >= bus.tx_len && tx_done(bus))
        {
            release_line(b);
            line_active(bus);
            bus.rx_len = 0;
            bus.complete = false;
            bus.since_ms = (uint32_t)millis();
            bus.state = BUS_AWAIT;
        }
        return;
    }

    if (bus.state == BUS_AWAIT)
        receive(b);
}

/** Begin bus `b`'s UART and RS-485 direction control, and its line timing; false when the bus cannot run. */
bool begin_bus(uint16_t b)
{
    const mb_master_bus_t &config = MB_MASTER_BUSES[b];
    Bus &bus = g_buses[b];
    if (config.baud == 0 || reserved(config.uart) || !begin_uart(config))
        return false;
    mb_rs485_init(config.uart, config.rs485_pin);
    const uint32_t bits = 1u + config.data_bits + (config.parity != MB_PARITY_N ? 1u : 0u) + config.stop_bits;
    bus.char_us = (bits * 1000000u + config.baud - 1u) / config.baud;
    bus.t35_us = config.baud > 19200u ? T35_FAST_US : (7u * bus.char_us + 1u) / 2u;
    return true;
}

}

void mb_master_rtu_start(void)
{
    for (uint16_t b = 0; b < MB_MASTER_BUS_COUNT; b++)
    {
        Bus &bus = g_buses[b];
        if (!bus.begun)
        {
            bus.begun = true;
            bus.state = begin_bus(b) ? BUS_IDLE : BUS_OFF;
        }
        if (bus.state == BUS_OFF)
        {
            mb_master_link_down(MB_MASTER_RTU, b);
            continue;
        }
        bus.tx_chars = 0;
        bus.tx_start_us = (uint32_t)micros();
        line_active(bus);
        finish(bus);
    }
}

void mb_master_rtu_stop(void)
{
    for (uint16_t b = 0; b < MB_MASTER_BUS_COUNT; b++)
    {
        Bus &bus = g_buses[b];
        if (bus.state == BUS_OFF || !bus.begun)
            continue;
        release_line(b);
        finish(bus);
    }
}

void mb_master_rtu_service(void)
{
    for (uint16_t b = 0; b < MB_MASTER_BUS_COUNT; b++)
    {
        if (g_buses[b].state != BUS_OFF)
            service(b);
    }
}

#endif
