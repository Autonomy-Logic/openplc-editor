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
#include "rtos_config.h"     // OPENPLC_RTOS: tasks instead of the loop below
#include "arduino_runtime_glue.h"
#if OPENPLC_RTOS
#include "plc_rtos.h"
#endif
#include "license_gate.h"
#include "license_store.h"   // license_store_read + LIC_BLOB_SIZE (via license_blob.h)

#if defined(MODBUS_ENABLED) || defined(DEBUGGER_ENABLED)
#include "ModbusSlave.h"
#endif

// Protocol servers. Included unconditionally: each facade is defined either way
// and the implementation compiles out when the target's VPP does not declare the
// capability. The call sites below are still guarded, because an unconditional
// call to an empty function keeps the call and the evaluation of its argument.
#include "opcua_server.h"
#include "opcua_log.h"
#include "s7comm_server.h"   // brings in s7comm_config.h -> S7COMM_ENABLED

// Network device-discovery responder ("Search" in the editor). Feature-gated so
// only targets declaring SUPPORTS_UDP_SCAN pull it in; unrelated to Modbus.
#if defined(SUPPORTS_UDP_SCAN)
#include "udp_scan.h"
// Weak NULL default for the discovery brand/type string. A VPP declares its
// identity with a strong OPLC_DEVICE_NAME in its HAL, which overrides this.
extern "C" { const char *OPLC_DEVICE_NAME __attribute__((weak)) = 0; }
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

#if OPENPLC_RTOS
// =============================================================================
// RTOS MODE: the serial ports are started by the task that uses them
//
// A port's interrupt is allocated on the core that calls begin(), and some
// serial drivers are only safe used from that core. So setup() only records
// which ports to start, and service A starts them before it serves a request.
// =============================================================================
static void (*s_rtos_serial_begins[2])(void);
static uint8_t s_rtos_serial_begin_count = 0;

// The parameter type is spelled out, not a typedef: arduino-cli writes a
// prototype for every function in this file above the file's own declarations.
static void rtos_defer_serial_begin(void (*begin)(void))
{
    if (s_rtos_serial_begin_count < 2) s_rtos_serial_begins[s_rtos_serial_begin_count++] = begin;
}

#define OPLC_SERIAL_BEGIN(iface, baud) rtos_defer_serial_begin([]() { (iface).begin(baud); })
#else
#define OPLC_SERIAL_BEGIN(iface, baud) (iface).begin(baud)
#endif

#if defined(OPLC_NET_ENABLED)
// =============================================================================
// NETWORK START-UP
//
// Two steps, because in RTOS mode two tasks own them (a peripheral is started
// by the task that uses it): the interface and the Modbus TCP listener belong
// to service A, OPC-UA and S7 to service B. The single loop runs both from
// setup(), in this order, forced inline into it.
// =============================================================================

// The interface, and the TCP listener on it. Gated on the NETWORK being
// enabled, not on Modbus being served: the link also carries the debugger, the
// ethernet upload, discovery, OPC-UA and S7Comm, and a board reached only over
// Ethernet must bring it up without a Modbus server.
static inline __attribute__((always_inline)) void oplc_net_begin(void)
{
    {
        uint8_t mac[] = { MBTCP_MAC };
        uint8_t ip[] = { MBTCP_IP };
        uint8_t dns[] = { MBTCP_DNS };
        uint8_t gateway[] = { MBTCP_GATEWAY };
        uint8_t subnet[] = { MBTCP_SUBNET };

        // Five byte arrays, `sizeof(arr) < 4` as a compile-time DHCP-vs-static
        // selector: an unset value is emitted as a single `0` byte.
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

    // The TCP listener: Modbus TCP when the project serves it, and the
    // debugger's transport regardless, on a board reached only this way.
    #ifdef MB_TCP_ACTIVE
        mbtcp_server_begin();
    #endif
}

// OPC-UA and S7Comm listen on the interface oplc_net_begin() brought up, and
// must not re-init the link themselves (see baremetal_net.h). No-ops when
// disabled.
static inline __attribute__((always_inline)) void oplc_protocols_begin(void)
{
    #if OPCUA_ENABLED
        opcua_log_begin();
        opcua_init();
    #endif
    #if S7COMM_ENABLED
        s7comm_init();
    #endif
}
#endif // OPLC_NET_ENABLED

#if OPENPLC_RTOS
// =============================================================================
// RTOS MODE: the service tasks' passes (plc_rtos.h)
//
// Defined here, not in plc_rtos.cpp, because the discovery responder's state
// lives in this translation unit (udp_scan.h). Modbus is mbtask()'s two
// transports, taken apart below; the register mirror runs inside each request,
// under the process-image lock (plc_rtos_run_pdu).
// =============================================================================
// Service A starts what it serves on before its first pass: the serial ports,
// the network interface and the Modbus TCP listener, and discovery; the network
// under the services' network lock (plc_rtos.h).
static void rtos_service_modbus_begin(void)
{
    for (uint8_t i = 0; i < s_rtos_serial_begin_count; i++) s_rtos_serial_begins[i]();
    #if defined(OPLC_NET_ENABLED) || defined(SUPPORTS_UDP_SCAN)
        plc_rtos_service_net_lock();
        #if defined(OPLC_NET_ENABLED)
            oplc_net_begin();
        #endif
        #if defined(SUPPORTS_UDP_SCAN)
            udp_scan_begin();
        #endif
        plc_rtos_service_net_unlock();
    #endif
}

// mbtask()'s two halves apart. The network half only when the network lock is
// free this moment: while a PLC task holds it (a block waiting on a connection)
// the pass skips it rather than hold up the serial port. handle_tcp() lets the
// lock go while it processes a request, and waits for it again to reply.
static void rtos_service_modbus(void)
{
    #if defined(SUPPORTS_UDP_SCAN) || defined(MB_TCP_ACTIVE)
        if (plc_rtos_service_net_try_lock())
        {
            #if defined(SUPPORTS_UDP_SCAN)
                udp_scan_poll();
            #endif
            #if defined(MB_TCP_ACTIVE)
                handle_tcp();
            #endif
            plc_rtos_service_net_unlock();
        }
    #endif
    #if defined(MB_SERIAL_ACTIVE)
        handle_serial();
    #endif
}

#if OPCUA_ENABLED || S7COMM_ENABLED
// Service B starts OPC-UA and S7 itself, once service A has the network up.
static void rtos_service_protocols_begin(void)
{
    #if defined(OPLC_NET_ENABLED)
        oplc_protocols_begin();
    #endif
}

// A task of their own, so a slow OPC-UA pass never delays the debugger. No scan
// shares this task, so each gets unlimited slack and its own due-time logic
// decides. Their sockets take the network lock per call (baremetal_net.cpp).
static void rtos_service_protocols(void)
{
    #if OPCUA_ENABLED
        opcuatask(UINT32_MAX);
    #endif
    #if S7COMM_ENABLED
        s7commtask(UINT32_MAX);
    #endif
}
#endif
#endif // OPENPLC_RTOS

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

    // Retained variables. init() decides what this runtime can do about them;
    // load() asks the driver for what it is holding, and the layout check
    // refuses values that no longer fit the declarations. Both must
    // follow runtime_bind_located_vars(), because a retained variable may also
    // be located and its storage has to be bound before anything writes to it.
    //
    // PROGRAM_MD5 and the buffer size are passed from here because the sketch
    // is on defines.h's one legitimate include path and the glue is not. The
    // buffer is exactly this program's retain blob (OPLC_RETAIN_BLOB_SIZE), so
    // there is no fixed cap: a program retains as much as its storage holds,
    // and the store answers TOO_LARGE if the board's storage is smaller.
#ifdef OPLC_RETAIN_BLOB_SIZE
    static_assert(OPLC_RETAIN_BLOB_SIZE <= 65535,
                  "The retain interface carries 16-bit lengths: retain fewer than 64 KB.");
    static uint8_t retain_storage[OPLC_RETAIN_BLOB_SIZE];
    runtime_retain_init(PROGRAM_MD5, retain_storage, (uint16_t)sizeof(retain_storage));
#else
    runtime_retain_init(PROGRAM_MD5, nullptr, 0);
#endif
    runtime_retain_load();

    // Initialize hardware (HAL -- unchanged)
    hardwareInit();

    // Establish the run/stop state. Must follow hardwareInit() so the HAL has
    // already configured its mode-switch pin: a board powered up with the
    // switch in STOP must never execute a scan. Boards with no mode switch
    // read RUN and start immediately, as they always have.
    runtime_init_plc_state();

    // -----------------------------------------------------------------------
    // License gate. Hand the stored license blob to the license-core so it can
    // verify it and arm its demo timer.
    //
    // With no license-core linked, `license_gate_init()` is the weak default in
    // license_gate_weak.cpp and this whole block is a harmless no-op: actuation
    // then stays unconditionally allowed, i.e. a board that never had licensing
    // behaves exactly as before. `millis()` gives the core the same time base the
    // runtime uses, with no esp_timer dependency.
    //
    // THE HARDWARE ANCHOR IS NOT PASSED IN. An earlier design read `UniqueID`
    // here and handed the bytes over, which made the board's IDENTITY a claim
    // made by the OPEN firmware: licensing hardware you do not own cost one edit
    // to this file, substituting the target's anchor. The license-core reads the
    // silicon itself, inside the closed artifact, so there is nothing here to
    // substitute. (FC 0x48 still REPORTS the anchor to the editor, so a purchase
    // can be bound to this board — reporting an identity and asserting one are
    // different things.)
    // -----------------------------------------------------------------------
    {
        // Zero-initialised: on a failed read the core is handed length 0, and a
        // buffer of indeterminate bytes behind a zero length is the kind of detail
        // that turns into a hard-to-place bug the first time someone reads past it.
        uint8_t lic_blob[LIC_BLOB_SIZE] = {0};
        size_t  lic_len = 0;
        if (license_store_read(lic_blob, sizeof(lic_blob), &lic_len) != LIC_STORE_OK)
        {
            // EMPTY / CORRUPT / UNSUPPORTED / any error: nothing usable was read,
            // so present a zero-length blob. The core's verify rejects it and
            // starts the demo window; with no core the weak gate ignores the args.
            lic_len = 0;
        }

        license_gate_init(lic_blob, lic_len, (uint32_t)millis());
    }

    #ifdef MODBUS_ENABLED
        #ifdef MBSERIAL
            #ifdef MBSERIAL_ON_SECONDARY
                // Dual-serial: Modbus RTU runs on a secondary UART (below) while
                // the always-on debugger keeps the default serial — bring it up.
                OPLC_SERIAL_BEGIN(DEBUG_IFACE, DEBUG_BAUD);
            #endif
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
                OPLC_SERIAL_BEGIN(MBSERIAL_IFACE, MBSERIAL_BAUD);
                mbconfig_serial_iface(&MBSERIAL_IFACE, MBSERIAL_BAUD, MBSERIAL_TXPIN);
            #else
                OPLC_SERIAL_BEGIN(MBSERIAL_IFACE, MBSERIAL_BAUD);
                mbconfig_serial_iface(&MBSERIAL_IFACE, MBSERIAL_BAUD, -1);
            #endif
            modbus.slaveid = MBSERIAL_SLAVE;
            // Two models, chosen by which UART the project gave Modbus RTU:
            //
            //  - MBSERIAL_SHARES_DEBUG_SERIAL: the RTU port IS the debugger's
            //    default serial, so the single begin() above brings up both and
            //    one mb_serialport serves them.
            //  - MBSERIAL_ON_SECONDARY: the RTU has its own UART and the
            //    debugger keeps the default one, begun further up. `handle_serial`
            //    polls both, each with its own RX assembly buffer.
            //
            // The second case was once listed here as an unimplemented
            // follow-up; it landed in 4b3c1386f and is now the normal shape,
            // since the editor's connection occupies the default port.
        #elif defined(DEBUGGER_ENABLED)
            // Modbus TCP-only build: no MBSERIAL, but the always-on debugger
            // still needs the default serial up on mb_serialport to respond.
            OPLC_SERIAL_BEGIN(DEBUG_IFACE, DEBUG_BAUD);
            mbconfig_serial_iface(&DEBUG_IFACE, DEBUG_BAUD, -1);
            modbus.slaveid = DEBUG_SLAVE;
        #endif

        init_mbregs(MAX_ANALOG_OUTPUT + MAX_MEMORY_WORD, MAX_MEMORY_DWORD, MAX_MEMORY_LWORD, MAX_DIGITAL_OUTPUT, MAX_ANALOG_INPUT, MAX_DIGITAL_INPUT);
        mapEmptyBuffers();
    #elif defined(DEBUGGER_ENABLED)
        // Always-on debugger without full Modbus: bring up the serial port and
        // the Modbus RTU framing/slave id ONLY. The debugger reads/writes IEC
        // variables directly through the strucpp debug table (openplc_debug_*),
        // so it needs NO operation buffers — init_mbregs()/mapEmptyBuffers() are
        // deliberately not called here, saving SRAM on small boards.
        OPLC_SERIAL_BEGIN(DEBUG_IFACE, DEBUG_BAUD);
        mbconfig_serial_iface(&DEBUG_IFACE, DEBUG_BAUD, -1);
        modbus.slaveid = DEBUG_SLAVE;
    #endif

    // ---- The network, on its own switch ----------------------------------
    //
    // Gated on the NETWORK being enabled, not on Modbus being served; see
    // oplc_net_begin(). In RTOS mode the service tasks start all of this
    // themselves, each the part it uses (plc_rtos.h).
#if defined(OPLC_NET_ENABLED) && !OPENPLC_RTOS
    oplc_net_begin();
    oplc_protocols_begin();
#endif

#if defined(SUPPORTS_UDP_SCAN) && !OPENPLC_RTOS
    // Network is up now; start answering editor discovery probes.
    udp_scan_begin();
#endif

#if defined(BOARD_LOGO8)
    // The LOGO! core defers its SysTick/millis() time base, because its reset
    // path skips the Energia _init that would start it. Start it here and before
    // setupCycleDelay(), so the scan-cycle baseline is captured from a running
    // micros(); otherwise the first cycle underflows and the scan runs unthrottled.
    (*(volatile uint32_t *)0xE000E014u) = (F_CPU / 1000U) - 1U;  /* SYST_RVR */
    (*(volatile uint32_t *)0xE000E018u) = 0U;                    /* SYST_CVR */
    (*(volatile uint32_t *)0xE000E010u) = 0x00000007U;           /* SYST_CSR: CLK|TICKINT|EN */
#endif

    setupCycleDelay(base_tick_ns);

#if OPENPLC_RTOS
    // Everything is up: start the IEC work, the services and the dispatcher
    // (plc_rtos_start). The sketch's setup runs in its IEC task, once the
    // network is up (plc_rtos_config_t).
    {
        plc_rtos_config_t rtos = {};
        rtos.service_a_begin = rtos_service_modbus_begin;
        rtos.service_a       = rtos_service_modbus;
        #if OPCUA_ENABLED || S7COMM_ENABLED
            rtos.service_b_begin = rtos_service_protocols_begin;
            rtos.service_b       = rtos_service_protocols;
        #endif
        #ifdef USE_ARDUINO_SKETCH
            rtos.sketch_setup = sketch_setup;
            rtos.after_scan   = sketch_loop;
        #endif
        plc_rtos_start(&rtos);
    }
#else
    #ifdef USE_ARDUINO_SKETCH
        sketch_setup();
    #endif
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

    // The reverse-copies above (COILS → bool_output, holding → int_output,
    // memory) write located variables' raw storage directly, clobbering any
    // debugger force. Re-impose forces here so forcing works while STILL
    // mirroring Modbus client writes into mapped outputs. (Supersedes the open
    // PR #719, which made forcing work by deleting the digital reverse-copy —
    // at the cost of Modbus coil mirroring.)
    runtime_apply_located_forces();
}
#endif

// =============================================================================
// SCHEDULER
// =============================================================================
/** How much of the current scan cycle is still unspent.
 *
 *  Zero once the cycle is already over budget, so a late caller is told there
 *  is no room rather than being handed a huge number from unsigned wraparound.
 *  OPC-UA uses this to decide whether it may run at all; see opcuatask(). */
static inline uint32_t cycle_slack_us()
{
    const unsigned long used = micros() - last_run;
    return (used >= scan_cycle) ? 0u : (uint32_t)(scan_cycle - used);
}

void scheduler()
{
    runtime_plc_cycle();

    #ifdef USE_ARDUINO_SKETCH
        sketch_loop();
    #endif

    #if defined(MODBUS_ENABLED)
        modbusTask();
    #elif defined(DEBUGGER_ENABLED)
        // Debug-only: poll the serial transport for debugger requests. No buffer
        // sync (modbusTask's mirror loops) because there are no operation buffers.
        mbtask();
    #endif

    // OPC-UA and S7Comm get the tail of the cycle, after the PLC logic and
    // Modbus. Each is handed what remains and declines to run unless that covers
    // its worst case, so neither can extend the cycle. No-ops when disabled.
    //
    // cycle_slack_us() is called twice deliberately: the protocols share one
    // budget, so the second sees what the first actually spent.
    //
    // Guarded rather than relying on the no-op bodies, because the call and its
    // micros() argument survive when the body compiles to `return`.
    #if OPCUA_ENABLED
        opcuatask(cycle_slack_us());
    #endif
    #if S7COMM_ENABLED
        s7commtask(cycle_slack_us());
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
#if OPENPLC_RTOS
    // The dispatcher, which never returns, so the core's loop wrapper never
    // pauses it between calls. Nothing where the dispatcher is a task of its own
    // (see plc_rtos_loop).
    plc_rtos_loop();
#else
#if defined(SUPPORTS_UDP_SCAN)
    // Answer editor discovery probes every iteration, independent of the scan
    // cycle, so Search stays responsive even with a long task interval.
    udp_scan_poll();
#endif

    if ((micros() - last_run) >= scan_cycle)
    {
        scheduler();
        last_run += scan_cycle;
    }

    #if defined(MODBUS_ENABLED)
    // Only run Modbus task again if we have at least 10ms gap until the next
    // cycle: what is LEFT of the cycle, not the time since `last_run`, which is
    // what is already spent.
    if (cycle_slack_us() >= 10000)
    {
        modbusTask();
    }
    #elif defined(DEBUGGER_ENABLED)
    // Debug-only: give the debugger extra serial-poll time between cycles too.
    if (cycle_slack_us() >= 10000)
    {
        mbtask();
    }
    #endif

    // OPC-UA gets the same inter-cycle slack Modbus does. Servicing it only from
    // scheduler() capped it at one message per scan while Modbus was polled
    // twice per cycle. No fixed guard is needed here: opcuatask() is given the
    // real remaining slack and decides for itself. Guarded for the same reason
    // as in scheduler().
    #if OPCUA_ENABLED
        opcuatask(cycle_slack_us());
    #endif
    #if S7COMM_ENABLED
        s7commtask(cycle_slack_us());
    #endif

    #ifdef SIMULATOR_MODE
    __asm volatile("sleep");
    #endif
#endif // OPENPLC_RTOS
}
