/*
modbus_serial.h - Modbus RTU / debugger serial transport
Copyright (C) 2022 OpenPLC - Thiago Alves

The serial wire: RTU framing (declared-length, not byte-cadence), RS485 tx-enable
timing, and single- or dual-serial polling. It fills mb_frame with a request,
asks modbus_pdu for the frame shape / CRC policy, calls process_mbpacket() and
writes the response back — it holds NO knowledge of the function-code set.
*/

#ifndef MODBUS_SERIAL_H
#define MODBUS_SERIAL_H

#include "modbus_frame.h"

// Serial timing/port state, configured once by mbconfig_serial_iface().
extern Stream* mb_serialport;
extern int8_t mb_txpin;
extern uint16_t mb_t15; // inter character time out
extern uint16_t mb_t35; // frame delay

// Bind + configure the serial interface (RS485 driver-enable pin, T1.5/T3.5
// timing derived from baud). Serial.begin() itself happens in the .ino sketch.
void mbconfig_serial_iface(Stream* port, long baud, int txPin);

#ifdef MB_SERIAL_ACTIVE
// Poll the serial port(s) for a complete RTU/debugger frame and answer it.
// Non-blocking; called every scan cycle.
void handle_serial();
#endif

#endif
