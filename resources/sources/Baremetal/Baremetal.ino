// Baremetal.ino -- OpenPLC Arduino runtime entry sketch.
//
// This is a STATIC sketch -- the same code for every project. It hosts the
// I/O buffers, Modbus glue, and the scan-cycle scheduler. Every strucpp
// type, every PLC POU instance, and every library body lives in the
// arduino library at src/ (compiled as separate translation units that
// never see Arduino.h). The sketch only talks to that library through the
// thin C-linkage surface in arduino_runtime_glue.h.
//
// Why the separation: arduino-cli auto-prepends <Arduino.h> to every .ino
// translation unit. Arduino.h defines macros named DEFAULT / HIGH / LOW /
// PI / B0..B7 / INPUT / OUTPUT and others that collide with struct member
// names emitted by strucpp's library bodies (most visibly OSCAT's
// CONSTANTS_LANGUAGE.DEFAULT). Keeping every strucpp class body out of
// the .ino's TU removes the entire class of collisions in one move.

// Arduino.h defines min/max/abs/round as function-like macros that break
// C++ standard library templates (<algorithm>, <limits>, etc).
#undef min
#undef max
#undef abs
#undef round

// Triggers arduino-cli's library discovery for the OpenPLCUserLib precompiled
// archive. Without this include arduino-cli still finds the library on disk
// but skips linking against the .a (no header match in the sketch).
#include <OpenPLCUserLib.h>

#include "openplc.h"
#include "defines.h"
#include "arduino_runtime_glue.h"

#ifdef MODBUS_ENABLED
#include "ModbusSlave.h"
#endif

// Include WiFi lib to turn off WiFi radio on ESP32/ESP8266 if not using WiFi
#ifndef MBTCP
    #if defined(BOARD_ESP8266)
        #include <ESP8266WiFi.h>
    #elif defined(BOARD_ESP32)
        #include <WiFi.h>
    #endif
#endif

// ---------------------------------------------------------------------------
// AVR: provide sized operator delete (virtual destructors generate this).
// Non-AVR libstdc++ already declares operator delete(void*, size_t) noexcept;
// redeclaring here causes a signature mismatch on ARM/mbed cores.
// ---------------------------------------------------------------------------
#ifdef __AVR__
void operator delete(void* ptr, unsigned int)
{
    free(ptr);
}
#endif

// ---------------------------------------------------------------------------
// I/O Buffer definitions (declared extern in openplc.h, must be defined
// here so they have external linkage. The glue's runtime_bind_located_vars
// reads/writes these slots.)
// ---------------------------------------------------------------------------
IEC_BOOL *bool_input[MAX_DIGITAL_INPUT/8][8] = {};
IEC_BOOL *bool_output[MAX_DIGITAL_OUTPUT/8][8] = {};
IEC_UINT *int_input[MAX_ANALOG_INPUT] = {};
IEC_UINT *int_output[MAX_ANALOG_OUTPUT] = {};
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
// REAL-typed I/O at %ID / %QD.  Populated by `runtime_bind_located_vars`
// when the IEC program declares a REAL variable AT %ID<n> / %QD<n>.
// Drivers that want to deliver engineering-unit values (volts, mA, °C)
// instead of raw ADC counts write into these slots — the Opta HAL is
// the first consumer.
IEC_REAL *real_input[MAX_REAL_INPUT] = {};
IEC_REAL *real_output[MAX_REAL_OUTPUT] = {};
IEC_UINT *int_memory[MAX_MEMORY_WORD] = {};
IEC_UDINT *dint_memory[MAX_MEMORY_DWORD] = {};
IEC_ULINT *lint_memory[MAX_MEMORY_LWORD] = {};
#endif

// ---------------------------------------------------------------------------
// Scan cycle timing
// ---------------------------------------------------------------------------
unsigned long scan_cycle;
unsigned long last_run = 0;
bool first_cycle = false;

// ---------------------------------------------------------------------------
// Module includes and external sketch support
// ---------------------------------------------------------------------------
#include "arduino_libs.h"

#ifdef USE_ARDUINO_SKETCH
    #include "ext/arduino_sketch.h"
#endif

extern uint8_t pinMask_DIN[];
extern uint8_t pinMask_AIN[];
extern uint8_t pinMask_DOUT[];
extern uint8_t pinMask_AOUT[];

// ---------------------------------------------------------------------------
// Scan cycle delay setup
// ---------------------------------------------------------------------------
void setupCycleDelay(unsigned long long cycle_time)
{
    scan_cycle = (uint32_t)(cycle_time / 1000);
    last_run = micros();
}

// =============================================================================
// SETUP
// =============================================================================
void setup()
{
    // Turn off WiFi radio on ESP32/ESP8266 if not using WiFi
    #ifndef MBTCP
        #if defined(BOARD_ESP8266) || defined(BOARD_ESP32)
            WiFi.mode(WIFI_OFF);
        #endif
    #endif

    // Bind located variables to I/O buffer pointers
    runtime_bind_located_vars();

    // Discover tasks and compute scheduling
    runtime_discover_tasks();

    // Initialize hardware (HAL -- unchanged)
    hardwareInit();

    #ifdef MODBUS_ENABLED
        #ifdef MBSERIAL
            #ifdef MBSERIAL_TXPIN
                // Disable TX pin from OpenPLC hardware layer
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
        #endif

        #ifdef MBTCP
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
        #endif

        init_mbregs(MAX_ANALOG_OUTPUT + MAX_MEMORY_WORD, MAX_MEMORY_DWORD, MAX_MEMORY_LWORD, MAX_DIGITAL_OUTPUT, MAX_ANALOG_INPUT, MAX_DIGITAL_INPUT);
        mapEmptyBuffers();
    #endif

    setupCycleDelay(base_tick_ns);

    #ifdef USE_ARDUINO_SKETCH
        sketch_setup();
    #endif
}

// =============================================================================
// MAP EMPTY BUFFERS (for Modbus)
// =============================================================================
#ifdef MODBUS_ENABLED
void mapEmptyBuffers()
{
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; i++)
    {
        if (bool_output[i/8][i%8] == NULL)
        {
            bool_output[i/8][i%8] = (IEC_BOOL *)malloc(sizeof(IEC_BOOL));
            *bool_output[i/8][i%8] = 0;
        }
    }
    for (int i = 0; i < MAX_ANALOG_OUTPUT; i++)
    {
        if (int_output[i] == NULL)
        {
            int_output[i] = (IEC_UINT *)(modbus.holding + i);
        }
    }
    for (int i = 0; i < MAX_DIGITAL_INPUT; i++)
    {
        if (bool_input[i/8][i%8] == NULL)
        {
            bool_input[i/8][i%8] = (IEC_BOOL *)malloc(sizeof(IEC_BOOL));
            *bool_input[i/8][i%8] = 0;
        }
    }
    for (int i = 0; i < MAX_ANALOG_INPUT; i++)
    {
        if (int_input[i] == NULL)
        {
            int_input[i] = (IEC_UINT *)(modbus.input_regs + i);
        }
    }
    #if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
        for (int i = 0; i < MAX_MEMORY_WORD; i++)
        {
            if (int_memory[i] == NULL)
            {
                int_memory[i] = (IEC_UINT *)(modbus.holding + MAX_ANALOG_OUTPUT + i);
            }
        }
        for (int i = 0; i < MAX_MEMORY_DWORD; i++)
        {
            if (dint_memory[i] == NULL)
            {
                dint_memory[i] = (IEC_UDINT *)(modbus.dint_memory + i);
            }
        }
        for (int i = 0; i < MAX_MEMORY_LWORD; i++)
        {
            if (lint_memory[i] == NULL)
            {
                lint_memory[i] = (IEC_ULINT *)(modbus.lint_memory + i);
            }
        }
    #endif
}

// =============================================================================
// MODBUS TASK
// =============================================================================
void modbusTask()
{
    // Sync OpenPLC Buffers with Modbus Buffers
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; i++)
    {
        if (bool_output[i/8][i%8] != NULL)
        {
            write_discrete(i, COILS, (bool)*bool_output[i/8][i%8]);
        }
    }
    for (int i = 0; i < MAX_ANALOG_OUTPUT; i++)
    {
        if (int_output[i] != NULL)
        {
            modbus.holding[i] = *int_output[i];
        }
    }
    for (int i = 0; i < MAX_DIGITAL_INPUT; i++)
    {
        if (bool_input[i/8][i%8] != NULL)
        {
            write_discrete(i, INPUTSTATUS, (bool)*bool_input[i/8][i%8]);
        }
    }
    for (int i = 0; i < MAX_ANALOG_INPUT; i++)
    {
        if (int_input[i] != NULL)
        {
            modbus.input_regs[i] = *int_input[i];
        }
    }
    #if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
        for (int i = 0; i < MAX_MEMORY_WORD; i++)
        {
            if (int_memory[i] != NULL)
            {
                modbus.holding[i + MAX_ANALOG_OUTPUT] = *int_memory[i];
            }
        }
        for (int i = 0; i < MAX_MEMORY_DWORD; i++)
        {
            if (dint_memory[i] != NULL)
            {
                modbus.dint_memory[i] = *dint_memory[i];
            }
        }
        for (int i = 0; i < MAX_MEMORY_LWORD; i++)
        {
            if (lint_memory[i] != NULL)
            {
                modbus.lint_memory[i] = *lint_memory[i];
            }
        }
    #endif

    // Read changes from clients
    mbtask();

    // Write changes back to OpenPLC Buffers
    for (int i = 0; i < MAX_DIGITAL_OUTPUT; i++)
    {
        if (bool_output[i/8][i%8] != NULL)
        {
            *bool_output[i/8][i%8] = get_discrete(i, COILS);
        }
    }
    for (int i = 0; i < MAX_ANALOG_OUTPUT; i++)
    {
        if (int_output[i] != NULL)
        {
            *int_output[i] = modbus.holding[i];
        }
    }
    #if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
        for (int i = 0; i < MAX_MEMORY_WORD; i++)
        {
            if (int_memory[i] != NULL)
            {
                *int_memory[i] = modbus.holding[i + MAX_ANALOG_OUTPUT];
            }
        }
        for (int i = 0; i < MAX_MEMORY_DWORD; i++)
        {
            if (dint_memory[i] != NULL)
            {
                *dint_memory[i] = modbus.dint_memory[i];
            }
        }
        for (int i = 0; i < MAX_MEMORY_LWORD; i++)
        {
            if (lint_memory[i] != NULL)
            {
                *lint_memory[i] = modbus.lint_memory[i];
            }
        }
    #endif
}
#endif

// =============================================================================
// SCHEDULER
// =============================================================================
void scheduler()
{
    runtime_plc_cycle();

    #ifdef USE_ARDUINO_SKETCH
        sketch_loop();
    #endif

    #ifdef MODBUS_ENABLED
        modbusTask();
    #endif

    if (!first_cycle)
    {
        first_cycle = true;
        // Recalculate last_run to avoid time drift on the first cycle
        last_run = micros() - scan_cycle;
    }
}

// =============================================================================
// MAIN LOOP
// =============================================================================
void loop()
{
    if ((micros() - last_run) >= scan_cycle)
    {
        scheduler();
        last_run += scan_cycle;
    }

    #ifdef MODBUS_ENABLED
    // Only run Modbus task again if we have at least 10ms gap until the next cycle
    if ((micros() - last_run) >= 10000)
    {
        modbusTask();
    }
    #endif

    #ifdef SIMULATOR_MODE
    __asm volatile("sleep");
    #endif
}
