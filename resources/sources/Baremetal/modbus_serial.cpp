// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#include "modbus_serial.h"
#include "modbus_pdu.h"
#include "modbus_crc.h"
#include "modbus_rs485.h"

//Serial timing/port state.
Stream* mb_serialport;
int8_t mb_txpin;
uint16_t mb_t15;
uint16_t mb_t35;

void mbconfig_serial_iface(Stream* port, long baud, int txPin)
{
    mb_serialport = port;
    mb_txpin = txPin;

    mb_rs485_init(port, txPin);


    if (baud > 19200)
        mb_t15 = 750;
    else
        mb_t15 = 16500000/baud;


    mb_t35 = mb_t15 * 3.5;
}

#ifdef MB_SERIAL_ACTIVE
// Inter-frame idle, in milliseconds, used ONLY to abandon a frame whose remainder never arrives.
#define MB_RTU_FRAME_GAP_MS 8

// Persistent RX-assembly state. handle_serial() is called every scan cycle and
// never blocks; a request whose bytes straddle several calls is carried across
// them in the port's assembly buffer.
static uint16_t mb_rx_len = 0;
static uint32_t mb_rx_last_ms = 0;

#ifdef MBTCP
// Serial RX-assembly buffer of a build that also serves TCP.
static uint8_t mb_rx_single[MAX_MB_FRAME];
#endif

#ifdef MBSERIAL_ON_SECONDARY
// Dual-serial: the debugger keeps the default serial while Modbus RTU runs on a distinct UART.
static uint8_t  mb_rx_dbg[MAX_MB_FRAME];
static uint16_t mb_rx_dbg_len = 0;
static uint32_t mb_rx_dbg_last_ms = 0;
static uint8_t  mb_rx_rtu[MAX_MB_FRAME];
static uint16_t mb_rx_rtu_len = 0;
static uint32_t mb_rx_rtu_last_ms = 0;
#endif

// Drop the first `k` bytes of the assembly buffer, keeping the remainder.
static void mb_rtu_drop_front(uint8_t *buf, uint16_t *plen, uint16_t k)
{
    if (k >= *plen) { *plen = 0; return; }
    for (uint16_t i = k; i < *plen; i++)
        buf[i - k] = buf[i];
    *plen = (uint16_t)(*plen - k);
}

// Service ONE serial port.
static void handle_serial_port(Stream *port, int8_t txpin, uint8_t slaveid,
                               uint8_t editorid, uint8_t *buf, uint16_t *plen,
                               uint32_t *plast)
{
    uint16_t packet_crc;

    while (port->available() > 0)
    {
        if (*plen >= MAX_MB_FRAME) break;
        buf[(*plen)++] = (uint8_t)port->read();
        *plast = millis();
    }

    for (;;)
    {
        if (*plen == 0)
            return;

        const bool editor_only = (buf[0] != slaveid) && (buf[0] == editorid);
        const bool public_only = (buf[0] == slaveid) && (buf[0] != editorid);

        if (buf[0] != slaveid && !editor_only)
        {
            mb_rtu_drop_front(buf, plen, 1);
            continue;
        }

        if (editor_only && *plen >= 2 && !mb_pdu_is_editor_fc(buf[1]))
        {
            mb_rtu_drop_front(buf, plen, 1);
            continue;
        }

        int32_t expected = mb_pdu_request_len(buf, *plen);

        if (expected < 0 || expected > MAX_MB_FRAME)
        {
            mb_rtu_drop_front(buf, plen, 1);
            continue;
        }
        if (expected == 0 || *plen < (uint16_t)expected)
        {
            if ((uint32_t)(millis() - *plast) > MB_RTU_FRAME_GAP_MS)
                *plen = 0;
            return;
        }

        if (buf != mb_frame)
        {
            for (int32_t i = 0; i < expected; i++) mb_frame[i] = buf[i];
        }

        if (!editor_only || !mb_pdu_skips_crc(mb_frame[1]))
        {
            mb_frame_len = (uint16_t)expected;
            packet_crc = ((mb_frame[expected - 2] << 8) | mb_frame[expected - 1]);
            if (packet_crc != calcCrc())
            {
                mb_rtu_drop_front(buf, plen, 1);
                continue;
            }
        }

        mb_frame_len = (uint16_t)expected - 2;

    if (public_only && mb_pdu_is_editor_fc(mb_frame[1]))
    {
        exceptionResponse(mb_frame[1], MB_EX_ILLEGAL_FUNCTION);
    }
    else
    {
        process_mbpacket();
    }

    if (mb_frame_len > MB_RESPONSE_CAPACITY) exceptionResponse(mb_frame[1], MB_EX_SLAVE_FAILURE);
    mb_frame_len += MB_CRC_SIZE;
    packet_crc = calcCrc();
    mb_frame[mb_frame_len - 2] = (uint8_t)(packet_crc >> 8);
    mb_frame[mb_frame_len - 1] = (uint8_t)(packet_crc & 0x00FF);

    if (txpin >= 0)
    {
        mb_rs485_pin(txpin, true);
        delayMicroseconds(mb_t35);
    }
    mb_rs485_board(port, true);

    port->write(mb_frame, mb_frame_len);
    port->flush();
    delayMicroseconds(mb_t35);

    mb_rs485_pin(txpin, false);
    mb_rs485_board(port, false);

        *plen = 0;
        return;
    }
}

// Dispatch to one or two serial ports.
void handle_serial()
{
#ifdef MBSERIAL_ON_SECONDARY
    handle_serial_port(&DEBUG_IFACE, -1, DEBUG_SLAVE, DEBUG_SLAVE, mb_rx_dbg, &mb_rx_dbg_len, &mb_rx_dbg_last_ms);
    #ifdef MBSERIAL_TXPIN
        handle_serial_port(&MBSERIAL_IFACE, MBSERIAL_TXPIN, MBSERIAL_SLAVE, MBSERIAL_SLAVE, mb_rx_rtu, &mb_rx_rtu_len, &mb_rx_rtu_last_ms);
    #else
        handle_serial_port(&MBSERIAL_IFACE, -1, MBSERIAL_SLAVE, MBSERIAL_SLAVE, mb_rx_rtu, &mb_rx_rtu_len, &mb_rx_rtu_last_ms);
    #endif
#else
    #ifdef MB_EDITOR_SLAVE
        const uint8_t editor_id = MB_EDITOR_SLAVE;
    #else
        const uint8_t editor_id = modbus.slaveid;
    #endif
    #ifdef MBTCP
        handle_serial_port(mb_serialport, mb_txpin, modbus.slaveid, editor_id, mb_rx_single, &mb_rx_len, &mb_rx_last_ms);
    #else
        handle_serial_port(mb_serialport, mb_txpin, modbus.slaveid, editor_id, mb_frame, &mb_rx_len, &mb_rx_last_ms);
    #endif
#endif
}
#endif
