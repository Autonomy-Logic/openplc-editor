// StrucppBaremetal.ino -- OpenPLC Arduino runtime for STruC++ generated code.
//
// This is a STATIC sketch -- the same code for every project. It dynamically
// discovers the project structure from STruC++ runtime types at setup() time:
// - Walks locatedVars[] to bind I/O to openplc.h buffer pointers
// - Walks Configuration → Resource → Task to discover programs and intervals
// - Computes GCD of task intervals for the scan cycle base tick
// - Schedules programs round-robin with per-task divisors

// Arduino.h defines min/max/abs/round as function-like macros that break
// C++ standard library templates (<algorithm>, <limits>, etc). Undefine them
// before including anything. TIMER* macros are left intact so user C/C++
// function blocks can reference them directly.
#undef min
#undef max
#undef abs
#undef round

// Include openplc.h FIRST (defines IEC_BOOL etc. as plain typedefs)
#include "openplc.h"
#include "defines.h"

// STruC++ headers define IEC_BOOL etc. inside namespace strucpp.
// Avoid "using namespace strucpp" globally to prevent ambiguity with openplc.h types.
#include "generated.hpp"

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
// AVR: provide sized operator delete (virtual destructors generate this)
// ---------------------------------------------------------------------------
void operator delete(void* ptr, unsigned int)
{
    free(ptr);
}

// ---------------------------------------------------------------------------
// I/O Buffer definitions (declared extern in openplc.h, must be defined here)
// ---------------------------------------------------------------------------
IEC_BOOL *bool_input[MAX_DIGITAL_INPUT/8][8] = {};
IEC_BOOL *bool_output[MAX_DIGITAL_OUTPUT/8][8] = {};
IEC_UINT *int_input[MAX_ANALOG_INPUT] = {};
IEC_UINT *int_output[MAX_ANALOG_OUTPUT] = {};
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
IEC_UINT *int_memory[MAX_MEMORY_WORD] = {};
IEC_UDINT *dint_memory[MAX_MEMORY_DWORD] = {};
IEC_ULINT *lint_memory[MAX_MEMORY_LWORD] = {};
#endif

// ---------------------------------------------------------------------------
// STruC++ Configuration instance (always CONFIG0 in OpenPLC).
// NOT static — the debugger's generated_debug.cpp references this global
// via compile-time address-of expressions (extern declaration) so it must
// have external linkage.
// ---------------------------------------------------------------------------
strucpp::Configuration_CONFIG0 g_config;

// ---------------------------------------------------------------------------
// Task scheduling state (populated by discoverTasks)
// ---------------------------------------------------------------------------
static strucpp::ProgramBase** all_programs = nullptr;
static uint32_t* task_divisors = nullptr;
static size_t total_programs = 0;
unsigned long long common_ticktime__ = 20000000ULL; // default 20ms, overwritten by discoverTasks

// ---------------------------------------------------------------------------
// Scan cycle timing
// ---------------------------------------------------------------------------
uint32_t __tick = 0;
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
// GCD utility
// ---------------------------------------------------------------------------
static uint64_t gcd(uint64_t a, uint64_t b)
{
    while (b)
    {
        uint64_t t = b;
        b = a % b;
        a = t;
    }
    return a;
}

// ---------------------------------------------------------------------------
// I/O Binding: walk locatedVars[] and bind to openplc.h buffer pointers
// ---------------------------------------------------------------------------
void bindLocatedVars()
{
    using namespace strucpp;
    for (uint32_t i = 0; i < locatedVarsCount; ++i)
    {
        LocatedVar& lv = locatedVars[i];
        if (!lv.pointer) continue;

        switch (lv.area)
        {
        case LocatedArea::Input:
            switch (lv.size)
            {
            case LocatedSize::Bit:
                bool_input[lv.byte_index][lv.bit_index] = (::IEC_BOOL*)lv.pointer;
                break;
            case LocatedSize::Word:
                int_input[lv.byte_index] = (::IEC_UINT*)lv.pointer;
                break;
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
            case LocatedSize::DWord:
                // dint_input not available on all boards
                break;
            case LocatedSize::LWord:
                // lint_input not available on all boards
                break;
#endif
            default: break;
            }
            break;

        case LocatedArea::Output:
            switch (lv.size)
            {
            case LocatedSize::Bit:
                bool_output[lv.byte_index][lv.bit_index] = (::IEC_BOOL*)lv.pointer;
                break;
            case LocatedSize::Word:
                int_output[lv.byte_index] = (::IEC_UINT*)lv.pointer;
                break;
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
            case LocatedSize::DWord:
                // dint_output not available on all boards
                break;
            case LocatedSize::LWord:
                // lint_output not available on all boards
                break;
#endif
            default: break;
            }
            break;

        case LocatedArea::Memory:
#if !defined(__AVR_ATmega328P__) && !defined(__AVR_ATmega168__) && !defined(__AVR_ATmega32U4__) && !defined(__AVR_ATmega16U4__)
            switch (lv.size)
            {
            case LocatedSize::Word:
                int_memory[lv.byte_index] = (::IEC_UINT*)lv.pointer;
                break;
            case LocatedSize::DWord:
                dint_memory[lv.byte_index] = (::IEC_UDINT*)lv.pointer;
                break;
            case LocatedSize::LWord:
                lint_memory[lv.byte_index] = (::IEC_ULINT*)lv.pointer;
                break;
            default: break;
            }
#endif
            break;
        }
    }
}

// ---------------------------------------------------------------------------
// Task Discovery: walk Configuration → Resource → Task to find programs
// ---------------------------------------------------------------------------
void discoverTasks()
{
    // First pass: count programs and compute GCD of intervals
    uint64_t gcd_ns = 0;
    size_t prog_count = 0;

    auto* resources = g_config.get_resources();
    for (size_t r = 0; r < g_config.get_resource_count(); ++r)
    {
        for (size_t t = 0; t < resources[r].task_count; ++t)
        {
            auto& task = resources[r].tasks[t];
            prog_count += task.program_count;
            uint64_t interval = task.interval_ns > 0 ? task.interval_ns : 20000000ULL;
            gcd_ns = (gcd_ns == 0) ? interval : gcd(gcd_ns, interval);
        }
    }

    if (gcd_ns == 0) gcd_ns = 20000000ULL;
    common_ticktime__ = gcd_ns;

    // Second pass: build flat arrays of programs and their divisors
    all_programs = new strucpp::ProgramBase*[prog_count];
    task_divisors = new uint32_t[prog_count];
    total_programs = prog_count;

    size_t idx = 0;
    for (size_t r = 0; r < g_config.get_resource_count(); ++r)
    {
        for (size_t t = 0; t < resources[r].task_count; ++t)
        {
            auto& task = resources[r].tasks[t];
            uint64_t interval = task.interval_ns > 0 ? task.interval_ns : gcd_ns;
            uint32_t divisor = (uint32_t)(interval / gcd_ns);
            for (size_t p = 0; p < task.program_count; ++p)
            {
                all_programs[idx] = task.programs[p];
                task_divisors[idx] = divisor;
                idx++;
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Time update
// ---------------------------------------------------------------------------
void updateTime()
{
    strucpp::__CURRENT_TIME_NS += (int64_t)common_ticktime__;
}

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
    bindLocatedVars();

    // Discover tasks and compute scheduling
    discoverTasks();

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

    setupCycleDelay(common_ticktime__);

    #ifdef USE_ARDUINO_SKETCH
        sketch_setup();
    #endif
}

// =============================================================================
// MAP EMPTY BUFFERS (for Modbus -- identical to current Baremetal.ino)
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
// MODBUS TASK (identical to current Baremetal.ino)
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
// PLC CYCLE TASK
// =============================================================================
void plcCycleTask()
{
    updateInputBuffers();

    // Run each program according to its task divisor
    for (size_t i = 0; i < total_programs; ++i)
    {
        if (task_divisors[i] == 0 || (__tick % task_divisors[i]) == 0)
        {
            all_programs[i]->run();
        }
    }
    __tick++;

    updateOutputBuffers();
    updateTime();
}

// =============================================================================
// SCHEDULER
// =============================================================================
void scheduler()
{
    plcCycleTask();

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
