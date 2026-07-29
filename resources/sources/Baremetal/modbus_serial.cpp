/*
modbus_serial.cpp - Modbus RTU / debugger serial transport
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#include "modbus_serial.h"
#include "modbus_pdu.h"   // process_mbpacket, mb_pdu_request_len, mb_pdu_skips_crc
#include "modbus_crc.h"   // calcCrc

#if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
#include "Controllino.h"
#endif

//Serial timing/port state.
Stream* mb_serialport;
int8_t mb_txpin;
uint16_t mb_t15; // inter character time out
uint16_t mb_t35; // frame delay

void mbconfig_serial_iface(Stream* port, long baud, int txPin)
{
    mb_serialport = port;
    mb_txpin = txPin;
    //(*port).begin(baud); //Initialization already happened on main .ino file

    //RS-485 control
    if (txPin >= 0)
    {
        pinMode(txPin, OUTPUT);
        digitalWrite(txPin, LOW);
    }

    #if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
        if (mb_serialport == &Serial3)
            Controllino_RS485Init();
    #elif defined(CONTROLLINO_MICRO)
    if (mb_serialport == &Serial2) {
        pinMode(CUSTOM_RS485_DEFAULT_DE_PIN, OUTPUT);
        pinMode(CUSTOM_RS485_DEFAULT_RE_PIN, OUTPUT);
        digitalWrite(CUSTOM_RS485_DEFAULT_DE_PIN, LOW);
        digitalWrite(CUSTOM_RS485_DEFAULT_RE_PIN, HIGH);
    }
    #endif

    // Modbus states that a baud rate higher than 19200 must use a fixed 750 us
    // for inter character time out. For baud rates below 19200 the timing
    // is more critical and has to be calculated.
    // E.g. 9600 baud in a 11 bit packet is 9600/11 = 872 characters per second
    // In milliseconds this will be 872 characters per 1000ms. So for 1 character
    // 1000ms/872 characters is 1.14583ms per character. Finally modbus states
    // an inter-character must be 1.5T or 1.5 times longer than a character. Thus
    // 1.5T = 1.14583ms * 1.5 = 1.71875ms.
    // Thus the formula is T1.5(us) = (1000ms * 1000(us) * 1.5 * 11bits)/baud
    // 1000ms * 1000(us) * 1.5 * 11bits = 16500000 can be calculated as a constant

    if (baud > 19200)
        mb_t15 = 750;
    else
        mb_t15 = 16500000/baud; // 1T * 1.5 = T1.5

    /* The modbus definition of a frame delay is a waiting period of 3.5 character times
    between packets.*/

    mb_t35 = mb_t15 * 3.5;
}

#ifdef MB_SERIAL_ACTIVE
// Inter-frame idle, in milliseconds, used ONLY to abandon a frame whose
// remainder never arrives. Modbus RTU was defined for RS485, where bytes of a
// frame are ~one character time apart (T1.5/T3.5, tens of microseconds at
// 115200) and the byte cadence delimits frames. That assumption is INVALID on
// USB-CDC (and any store-and-forward link): a single request is split into
// 64-byte USB packets separated by USB-frame-scale gaps far longer than T1.5,
// so cadence framing tears requests apart (the bug that made the P1AM-100 /
// SAMD21 debugger crawl). We therefore frame by the request's DECLARED length
// (derived from the function code) and fall back to this idle only to drop a
// truncated partial. It must exceed any intra-frame USB gap yet stay well below
// a master's request timeout.
#define MB_RTU_FRAME_GAP_MS 8

// Persistent RX-assembly state. handle_serial() is called every scan cycle and
// never blocks; a request whose bytes straddle several calls is carried across
// them in mb_frame[0..mb_rx_len). (This shares mb_frame with handle_tcp, which
// is safe because an OpenPLC board is configured for a single Modbus transport;
// the two are not driven mid-frame at the same time.)
static uint16_t mb_rx_len = 0;
static uint32_t mb_rx_last_ms = 0;

#ifdef MBSERIAL_ON_SECONDARY
// Dual-serial: the debugger keeps the default serial while Modbus RTU runs on a
// distinct UART. Each port needs its OWN RX assembly buffer — a partial frame on
// one port must survive while the other is serviced. `mb_frame` becomes a
// transient process/TX buffer, borrowed for one complete transaction at a time
// (safe: Modbus RTU is half-duplex turn-taking and the ports are polled
// sequentially). These extra buffers are compiled ONLY for boards that use a
// secondary Modbus serial (multi-UART, RAM-rich), so single-UART boards keep the
// original single-buffer footprint.
static uint8_t  mb_rx_dbg[MAX_MB_FRAME];
static uint16_t mb_rx_dbg_len = 0;
static uint32_t mb_rx_dbg_last_ms = 0;
static uint8_t  mb_rx_rtu[MAX_MB_FRAME];
static uint16_t mb_rx_rtu_len = 0;
static uint32_t mb_rx_rtu_last_ms = 0;
#endif

// Drop the first `k` bytes of the assembly buffer, keeping the remainder. Used
// for one-byte realignment on a bad/foreign frame head — NEVER a blind flush —
// so a genuine frame head sitting further into the buffer always survives and
// is eventually found (guarantees resync convergence; no "discard every frame"
// loop). Slides only run on the error path, so the O(n) cost is irrelevant.
static void mb_rtu_drop_front(uint8_t *buf, uint16_t *plen, uint16_t k)
{
    if (k >= *plen) { *plen = 0; return; }
    for (uint16_t i = k; i < *plen; i++)
        buf[i - k] = buf[i];
    *plen = (uint16_t)(*plen - k);
}

// Service ONE serial port. `buf`/`plen`/`plast` are the port's own RX-assembly
// state; `slaveid` is its framing id; `txpin` its RS485 driver-enable pin (-1
// when none). A complete frame is copied into the shared `mb_frame`, processed,
// and the response written back to `port`. In the single-serial build `buf` IS
// `mb_frame` (in-place, no copy); in the dual-serial build each port owns a
// distinct buffer and `mb_frame` is the transient process/TX scratch.
static void handle_serial_port(Stream *port, int8_t txpin, uint8_t slaveid,
                               uint8_t *buf, uint16_t *plen, uint32_t *plast)
{
    uint16_t packet_crc;

    // 1) Drain the RX buffer without blocking. One frame's bytes may arrive
    //    across several calls; the scan cycle is never stalled waiting on them.
    while (port->available() > 0)
    {
        if (*plen >= MAX_MB_FRAME) break;               // full — let the parser drain it
        buf[(*plen)++] = (uint8_t)port->read();
        *plast = millis();
    }

    // 2) Extract every complete frame in the buffer. Each iteration either
    //    consumes/realigns by >=1 byte or returns to await more data, so the
    //    loop always terminates.
    for (;;)
    {
        if (*plen == 0)
            return;

        // Header byte-alignment: the first byte must be THIS port's slave id.
        // This is the cheap framing check, and it is the ONLY validation applied
        // to debugger frames (CRC is deliberately skipped on debug FCs for
        // performance — those function codes are private and well-formed).
        if (buf[0] != slaveid)
        {
            mb_rtu_drop_front(buf, plen, 1);            // foreign/garbage head — slide
            continue;
        }

        int32_t expected = mb_pdu_request_len(buf, *plen);

        if (expected < 0 || expected > MAX_MB_FRAME)
        {
            mb_rtu_drop_front(buf, plen, 1);            // illegal FC / impossible length
            continue;
        }
        if (expected == 0 || *plen < (uint16_t)expected)
        {
            // Header incomplete, or the frame's tail has not arrived yet. Wait
            // for it; abandon the partial only if its remainder never comes.
            if ((uint32_t)(millis() - *plast) > MB_RTU_FRAME_GAP_MS)
                *plen = 0;
            return;
        }

        // 3) A full candidate frame occupies buf[0 .. expected). Move it into the
        //    shared process buffer (a no-op self-copy on the single-serial path,
        //    where buf already IS mb_frame).
        if (buf != mb_frame)
        {
            for (int32_t i = 0; i < expected; i++) mb_frame[i] = buf[i];
        }

        //    Standard FCs are validated by CRC (the arbiter that makes resync
        //    trustworthy); a mismatch means corruption or misalignment, so we
        //    slide one byte and retry instead of discarding the whole buffer.
        if (!mb_pdu_skips_crc(mb_frame[1]))
        {
            mb_frame_len = (uint16_t)expected;
            packet_crc = ((mb_frame[expected - 2] << 8) | mb_frame[expected - 1]);
            if (packet_crc != calcCrc())
            {
                mb_rtu_drop_front(buf, plen, 1);
                continue;
            }
        }

        // 4) Accepted. Hand the PDU (CRC stripped) to the shared processor,
        //    which builds the response back into mb_frame.
        mb_frame_len = (uint16_t)expected - 2;
    process_mbpacket();

    //Add CRC
    //Check if response message is too big for this device
    if (mb_frame_len + 2 > MAX_MB_FRAME) exceptionResponse(mb_frame[1], MB_EX_SLAVE_FAILURE);
    mb_frame_len += 2; //increase frame length by two bytes to acomodate CRC
    packet_crc = calcCrc(); //calculate CRC of the new packet
    mb_frame[mb_frame_len - 2] = (uint8_t)(packet_crc >> 8);
    mb_frame[mb_frame_len - 1] = (uint8_t)(packet_crc & 0x00FF);

    if (txpin >= 0)
    {
        digitalWrite(txpin, HIGH);
        delayMicroseconds(mb_t35);
    }

    #if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
        if (port == &Serial3) // RS485 serial port
            Controllino_RS485TxEnable(); // Enable RS485 chip to transmit
    #elif defined(CONTROLLINO_MICRO)
        if (port == &Serial2) {
            digitalWrite(CUSTOM_RS485_DEFAULT_DE_PIN, HIGH);
            digitalWrite(CUSTOM_RS485_DEFAULT_RE_PIN, HIGH);
        }
    #endif

    port->write(mb_frame, mb_frame_len);
    port->flush();
    delayMicroseconds(mb_t35);

    if (txpin >= 0)
        digitalWrite(txpin, LOW);

    #if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
        if (port == &Serial3) // RS485 serial port
            Controllino_RS485RxEnable(); // Go back to receive mode after transmitted data
    #elif defined(CONTROLLINO_MICRO)
        if (port == &Serial2) {
            digitalWrite(CUSTOM_RS485_DEFAULT_DE_PIN, LOW);
            digitalWrite(CUSTOM_RS485_DEFAULT_RE_PIN, LOW);
        }
    #endif

        // 5) The request — and the response built over it — consumed the whole
        //    assembly buffer. Modbus RTU is turn-taking: the master waits for
        //    this reply before sending its next request, so no following frame
        //    can already be buffered. Reset for the next request. A
        //    non-conformant pipelining master simply retransmits after its
        //    timeout, and the gap/realignment logic above recovers cleanly.
        *plen = 0;
        return;
    }
}

// Dispatch to one or two serial ports. Single-serial: the debugger and Modbus
// RTU (if any) share one port, assembled in-place in mb_frame. Dual-serial
// (MBSERIAL_ON_SECONDARY): the debugger keeps the default serial while Modbus
// RTU runs on a distinct UART — each with its own RX buffer.
void handle_serial()
{
#ifdef MBSERIAL_ON_SECONDARY
    handle_serial_port(&DEBUG_IFACE, -1, DEBUG_SLAVE, mb_rx_dbg, &mb_rx_dbg_len, &mb_rx_dbg_last_ms);
    #ifdef MBSERIAL_TXPIN
        handle_serial_port(&MBSERIAL_IFACE, MBSERIAL_TXPIN, MBSERIAL_SLAVE, mb_rx_rtu, &mb_rx_rtu_len, &mb_rx_rtu_last_ms);
    #else
        handle_serial_port(&MBSERIAL_IFACE, -1, MBSERIAL_SLAVE, mb_rx_rtu, &mb_rx_rtu_len, &mb_rx_rtu_last_ms);
    #endif
#else
    handle_serial_port(mb_serialport, mb_txpin, modbus.slaveid, mb_frame, &mb_rx_len, &mb_rx_last_ms);
#endif
}
#endif // MB_SERIAL_ACTIVE
