// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#undef min
#undef max
#undef abs
#undef round

#include <OpenPLCUserLib.h>

#include "openplc.h"
#include "defines.h"
#include "arduino_runtime_glue.h"
#include "license_gate.h"
#include "license_store.h"

#if defined(MODBUS_ENABLED) || defined(DEBUGGER_ENABLED)
#include "ModbusSlave.h"
#endif

#include "opcua_server.h"
#include "opcua_log.h"
#include "s7comm_server.h"
#include "modbus_master.h"

#if defined(SUPPORTS_UDP_SCAN)
#include "udp_scan.h"
// Weak NULL default for the discovery brand/type string. A VPP declares its
// identity with a strong OPLC_DEVICE_NAME in its HAL, which overrides this.
extern "C" { const char *OPLC_DEVICE_NAME __attribute__((weak)) = 0; }
#endif

#ifndef MBTCP
    #if defined(BOARD_ESP8266)
        #include <ESP8266WiFi.h>
    #elif defined(BOARD_ESP32)
        #include <WiFi.h>
    #endif
#endif

#ifdef __AVR__
void operator delete(void* ptr, unsigned int)
{
    free(ptr);
}
#endif

IEC_BOOL *bool_input[MAX_DIGITAL_INPUT/8][8] = {};
IEC_BOOL *bool_output[MAX_DIGITAL_OUTPUT/8][8] = {};
IEC_UINT *int_input[MAX_ANALOG_INPUT] = {};
IEC_UINT *int_output[MAX_ANALOG_OUTPUT] = {};
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
// REAL-typed I/O at %ID / %QD.
IEC_REAL *real_input[MAX_REAL_INPUT] = {};
IEC_REAL *real_output[MAX_REAL_OUTPUT] = {};
IEC_UINT *int_memory[MAX_MEMORY_WORD] = {};
IEC_UDINT *dint_memory[MAX_MEMORY_DWORD] = {};
IEC_ULINT *lint_memory[MAX_MEMORY_LWORD] = {};
#endif

unsigned long scan_cycle;
unsigned long last_run = 0;
bool first_cycle = false;

#ifdef USE_ARDUINO_SKETCH
    #include "ext/arduino_sketch.h"
#endif

extern uint8_t pinMask_DIN[];
extern uint8_t pinMask_AIN[];
extern uint8_t pinMask_DOUT[];
extern uint8_t pinMask_AOUT[];

void setupCycleDelay(unsigned long long cycle_time)
{
    scan_cycle = (uint32_t)(cycle_time / 1000);
    last_run = micros();
}

void setup()
{
    #ifndef MBTCP
        #if defined(BOARD_ESP8266) || defined(BOARD_ESP32)
            WiFi.mode(WIFI_OFF);
        #endif
    #endif

    runtime_bind_located_vars();

    runtime_discover_tasks();

    runtime_retain_init(PROGRAM_MD5);
    runtime_retain_load();

    hardwareInit();

    #if MB_MASTER_RTU_ENABLED
        for (uint16_t b = 0; b < MB_MASTER_BUS_COUNT; b++)
        {
            const int16_t pin = MB_MASTER_BUSES[b].rs485_pin;
            if (pin == MB_MASTER_NO_PIN) continue;
            for (int i = 0; i < NUM_DISCRETE_INPUT; i++)
            {
                if (pinMask_DIN[i] == pin) pinMask_DIN[i] = 255;
            }
            for (int i = 0; i < NUM_ANALOG_INPUT; i++)
            {
                if (pinMask_AIN[i] == pin) pinMask_AIN[i] = 255;
            }
            for (int i = 0; i < NUM_DISCRETE_OUTPUT; i++)
            {
                if (pinMask_DOUT[i] == pin) pinMask_DOUT[i] = 255;
            }
            for (int i = 0; i < NUM_ANALOG_OUTPUT; i++)
            {
                if (pinMask_AOUT[i] == pin) pinMask_AOUT[i] = 255;
            }
        }
    #endif

    runtime_init_plc_state();

    {
        uint8_t lic_blob[LIC_BLOB_SIZE] = {0};
        size_t  lic_len = 0;
        if (license_store_read(lic_blob, sizeof(lic_blob), &lic_len) != LIC_STORE_OK)
        {
            lic_len = 0;
        }

        license_gate_init(lic_blob, lic_len, (uint32_t)millis());
    }

    #ifdef MODBUS_ENABLED
        #ifdef MBSERIAL
            #ifdef MBSERIAL_ON_SECONDARY
                DEBUG_IFACE.begin(DEBUG_BAUD);
            #endif
            #ifdef MBSERIAL_TXPIN
                for (int i = 0; i < NUM_DISCRETE_INPUT; i++)
                {
                    if (pinMask_DIN[i] == MBSERIAL_TXPIN) pinMask_DIN[i] = 255;
                }
                for (int i = 0; i < NUM_ANALOG_INPUT; i++)
                {
                    if (pinMask_AIN[i] == MBSERIAL_TXPIN) pinMask_AIN[i] = 255;
                }
                for (int i = 0; i < NUM_DISCRETE_OUTPUT; i++)
                {
                    if (pinMask_DOUT[i] == MBSERIAL_TXPIN) pinMask_DOUT[i] = 255;
                }
                for (int i = 0; i < NUM_ANALOG_OUTPUT; i++)
                {
                    if (pinMask_AOUT[i] == MBSERIAL_TXPIN) pinMask_AOUT[i] = 255;
                }
                MBSERIAL_IFACE.begin(MBSERIAL_BAUD);
                mbconfig_serial_iface(&MBSERIAL_IFACE, MBSERIAL_BAUD, MBSERIAL_TXPIN);
            #else
                MBSERIAL_IFACE.begin(MBSERIAL_BAUD);
                mbconfig_serial_iface(&MBSERIAL_IFACE, MBSERIAL_BAUD, -1);
            #endif
            modbus.slaveid = MBSERIAL_SLAVE;
        #elif defined(DEBUGGER_ENABLED)
            DEBUG_IFACE.begin(DEBUG_BAUD);
            mbconfig_serial_iface(&DEBUG_IFACE, DEBUG_BAUD, -1);
            modbus.slaveid = DEBUG_SLAVE;
        #endif

    #elif defined(DEBUGGER_ENABLED)
        DEBUG_IFACE.begin(DEBUG_BAUD);
        mbconfig_serial_iface(&DEBUG_IFACE, DEBUG_BAUD, -1);
        modbus.slaveid = DEBUG_SLAVE;
    #endif

    #if defined(MODBUS_ENABLED) || S7COMM_ENABLED || MB_MASTER_ENABLED
        mapEmptyBuffers();
    #endif

#if defined(OPLC_NET_ENABLED)
    {
        uint8_t mac[] = { MBTCP_MAC };
        uint8_t ip[] = { MBTCP_IP };
        uint8_t dns[] = { MBTCP_DNS };
        uint8_t gateway[] = { MBTCP_GATEWAY };
        uint8_t subnet[] = { MBTCP_SUBNET };

        if (sizeof(ip)/sizeof(uint8_t) < 4)
            mbconfig_ethernet_iface(mac, NULL, NULL, NULL, NULL);
        else if (sizeof(dns)/sizeof(uint8_t) < 4)
            mbconfig_ethernet_iface(mac, ip, NULL, NULL, NULL);
        else if (sizeof(gateway)/sizeof(uint8_t) < 4)
            mbconfig_ethernet_iface(mac, ip, dns, NULL, NULL);
        else if (sizeof(subnet)/sizeof(uint8_t) < 4)
            mbconfig_ethernet_iface(mac, ip, dns, gateway, NULL);
        else
            mbconfig_ethernet_iface(mac, ip, dns, gateway, subnet);
    }

    #ifdef MB_TCP_ACTIVE
        mbtcp_server_begin();
    #endif

    #if OPCUA_ENABLED
        opcua_log_begin();
        opcua_init();
    #endif
    #if S7COMM_ENABLED
        s7comm_init();
    #endif
#endif

#if defined(SUPPORTS_UDP_SCAN)
    udp_scan_begin();
#endif

#if defined(BOARD_LOGO8)
    (*(volatile uint32_t *)0xE000E014u) = (F_CPU / 1000U) - 1U;
    (*(volatile uint32_t *)0xE000E018u) = 0U;
    (*(volatile uint32_t *)0xE000E010u) = 0x00000007U;
#endif

    setupCycleDelay(base_tick_ns);

    #ifdef USE_ARDUINO_SKETCH
        sketch_setup();
    #endif
}

#if defined(MODBUS_ENABLED) || S7COMM_ENABLED || MB_MASTER_ENABLED

// Storage for slots the program declared no variable for -- the image is a table of pointers into program
// variables, and those slots have none.
static IEC_BOOL empty_bits[MAX_DIGITAL_INPUT + MAX_DIGITAL_OUTPUT] = {};
static IEC_UINT empty_words[MAX_ANALOG_INPUT + MAX_ANALOG_OUTPUT] = {};
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
static IEC_UINT  empty_memory_words[MAX_MEMORY_WORD] = {};
static IEC_UDINT empty_memory_dwords[MAX_MEMORY_DWORD] = {};
static IEC_ULINT empty_memory_lwords[MAX_MEMORY_LWORD] = {};
#endif

void mapEmptyBuffers()
{
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; i++)
    {
        if (bool_output[i/8][i%8] == NULL)
        {
            bool_output[i/8][i%8] = &empty_bits[i];
        }
    }
    for (int i = 0; i < MAX_DIGITAL_INPUT; i++)
    {
        if (bool_input[i/8][i%8] == NULL)
        {
            bool_input[i/8][i%8] = &empty_bits[MAX_DIGITAL_OUTPUT + i];
        }
    }
    for (int i = 0; i < MAX_ANALOG_OUTPUT; i++)
    {
        if (int_output[i] == NULL)
        {
            int_output[i] = &empty_words[i];
        }
    }
    for (int i = 0; i < MAX_ANALOG_INPUT; i++)
    {
        if (int_input[i] == NULL)
        {
            int_input[i] = &empty_words[MAX_ANALOG_OUTPUT + i];
        }
    }
    #if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
        for (int i = 0; i < MAX_MEMORY_WORD; i++)
        {
            if (int_memory[i] == NULL)
            {
                int_memory[i] = &empty_memory_words[i];
            }
        }
        for (int i = 0; i < MAX_MEMORY_DWORD; i++)
        {
            if (dint_memory[i] == NULL)
            {
                dint_memory[i] = &empty_memory_dwords[i];
            }
        }
        for (int i = 0; i < MAX_MEMORY_LWORD; i++)
        {
            if (lint_memory[i] == NULL)
            {
                lint_memory[i] = &empty_memory_lwords[i];
            }
        }
    #endif
}

#endif

#ifdef MODBUS_ENABLED

// Nothing to synchronise: the FC handlers address the process image directly.
void modbusTask()
{
    mbtask();
}
#endif

/** How much of the current scan cycle is still unspent. */
static inline uint32_t cycle_slack_us()
{
    const unsigned long used = micros() - last_run;
    return (used >= scan_cycle) ? 0u : (uint32_t)(scan_cycle - used);
}

void scheduler()
{
    #if MB_MASTER_ENABLED
        mb_master_commit_inputs();
    #endif

    runtime_plc_cycle();

    #if MB_MASTER_ENABLED
        mb_master_sample_outputs();
    #endif

    #ifdef USE_ARDUINO_SKETCH
        sketch_loop();
    #endif

    #if defined(MODBUS_ENABLED)
        modbusTask();
    #elif defined(DEBUGGER_ENABLED)
        mbtask();
    #endif

    #if MB_MASTER_ENABLED
        mb_master_task();
    #endif

    #if OPCUA_ENABLED
        opcuatask(cycle_slack_us());
    #endif
    #if S7COMM_ENABLED
        s7commtask(cycle_slack_us());
    #endif

    runtime_apply_located_forces();

    if (!first_cycle)
    {
        first_cycle = true;
        last_run = micros() - scan_cycle;
    }
}

void loop()
{
#if defined(SUPPORTS_UDP_SCAN)
    udp_scan_poll();
#endif

    if ((micros() - last_run) >= scan_cycle)
    {
        scheduler();
        last_run += scan_cycle;
    }

    #if defined(MODBUS_ENABLED)
    if ((micros() - last_run) >= 10000)
    {
        modbusTask();
    }
    #elif defined(DEBUGGER_ENABLED)
    if ((micros() - last_run) >= 10000)
    {
        mbtask();
    }
    #endif

    #if OPCUA_ENABLED
        opcuatask(cycle_slack_us());
    #endif
    #if S7COMM_ENABLED
        s7commtask(cycle_slack_us());
    #endif

    #if MB_MASTER_ENABLED
        mb_master_task();
    #endif

    runtime_apply_located_forces();

    #ifdef SIMULATOR_MODE
    __asm volatile("sleep");
    #endif
}
