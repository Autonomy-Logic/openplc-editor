// plc_rtos.h — RTOS mode's tasks: the dispatcher, the IEC work, the services.
//
//   dispatcher (the highest priority)  releases the IEC work on the base tick,
//       skipping a release while the previous one still runs (never queueing
//       it), and moves the I/O: HAL inputs into the process image at the start
//       of a frame, the image to the outputs as each task finishes.
//   one worker per IEC task            runs that task's programs on its own
//       copy of its located variables, at a priority from the IEC PRIORITY (0
//       is the highest); one worker for all tasks when the runtime is not
//       threaded (runtime_rtos_worker_cycle).
//   service A                          Modbus RTU/TCP, the debugger and
//       discovery: one task, because they share one frame parser.
//   service B                          OPC-UA and S7, only when one is built in.
//
// The services reach program memory only through the image lock or a scan
// lock, and never hold either across I/O. See docs/rtos-mode.md.
//
// Compiled only in RTOS mode (OPENPLC_RTOS, from rtos_config.h).

#ifndef OPENPLC_PLC_RTOS_H
#define OPENPLC_PLC_RTOS_H

#include "rtos_config.h"

#if OPENPLC_RTOS

#include <stddef.h>
#include <stdint.h>

// ---- Tunables (the generated rtos_config.h may define any of them) ---------
//
// Priorities are the backend's own numbers and come from plc_os.h, which places
// them below the system's network and driver tasks on each platform, so a long
// scan can never starve the network, even on a single core.
#include "plc_os.h"

#ifndef OPENPLC_RTOS_DISPATCH_PRIORITY
#define OPENPLC_RTOS_DISPATCH_PRIORITY PLC_OS_PRIO_DISPATCH
#endif
#ifndef OPENPLC_RTOS_WORK_PRIORITY
#define OPENPLC_RTOS_WORK_PRIORITY PLC_OS_PRIO_WORK_TOP
#endif
#ifndef OPENPLC_RTOS_SERVICE_A_PRIORITY
#define OPENPLC_RTOS_SERVICE_A_PRIORITY PLC_OS_PRIO_SERVICE_A
#endif
#ifndef OPENPLC_RTOS_SERVICE_B_PRIORITY
#define OPENPLC_RTOS_SERVICE_B_PRIORITY PLC_OS_PRIO_SERVICE_B
#endif

// Stack sizes in bytes. The IEC work runs the program and every C/C++ block,
// some of which (TLS clients) need several kilobytes of their own.
#ifndef OPENPLC_RTOS_WORK_STACK
#define OPENPLC_RTOS_WORK_STACK 16384
#endif
#ifndef OPENPLC_RTOS_SERVICE_A_STACK
#define OPENPLC_RTOS_SERVICE_A_STACK 8192
#endif
#ifndef OPENPLC_RTOS_SERVICE_B_STACK
#define OPENPLC_RTOS_SERVICE_B_STACK 16384
#endif
// The dispatcher's, where it is a task of its own (PLC_OS_OWN_DISPATCHER): it
// runs the HAL and packs the retained values.
#ifndef OPENPLC_RTOS_DISPATCH_STACK
#define OPENPLC_RTOS_DISPATCH_STACK 8192
#endif

typedef void (*plc_rtos_hook_t)(void);

// Each service starts the peripherals it serves on in its own task, before its
// first pass: a port's interrupt and driver state belong to the task (and core)
// that began them. B waits for A, whose network it listens on.
typedef struct {
    // Service A's start-up: serial ports, network interface, Modbus TCP, discovery.
    plc_rtos_hook_t service_a_begin;
    // One pass of service A (discovery, then Modbus and the debugger). Required.
    plc_rtos_hook_t service_a;
    // Service B's start-up (OPC-UA, S7), run once A's has finished.
    plc_rtos_hook_t service_b_begin;
    // One pass of service B (OPC-UA, then S7). NULL when neither is built in.
    plc_rtos_hook_t service_b;
    // The optional Arduino sketch, run in the fastest IEC task (the first
    // declared, of equal ones) holding no lock: its setup before that task's
    // first scan, once service A has started the network, its loop after each
    // scan. NULL when absent.
    plc_rtos_hook_t sketch_setup;
    plc_rtos_hook_t after_scan;
} plc_rtos_config_t;

// End of setup(): create the IEC work and the service tasks. Without
// PLC_OS_OWN_DISPATCHER the calling thread becomes the dispatcher and loop()
// runs it; with it, the dispatcher is created as a task and the scheduler is
// started, and this returns only if the RTOS could not start.
void plc_rtos_start(const plc_rtos_config_t *config);

// loop()'s body in RTOS mode: the dispatcher, which never returns, or nothing
// where the dispatcher is a task of its own.
void plc_rtos_loop(void);

// Run one Modbus PDU (process_mbpacket's body) under the lock its function code
// needs: the image lock for the data codes and those reaching HAL code, the
// owners' scan locks for the debugger's reads and writes of program variables,
// none for the rest. Answers "slave device busy" when a scan does not yield in
// time.
void plc_rtos_run_pdu(uint8_t function_code, plc_rtos_hook_t pdu_body);

// A service answered "busy" (a task's scan did not yield in time): counted per
// service in the task statistics.
void plc_rtos_count_busy(void);

// ---- The network, bus and serial port locks ----------------------------------
//
// The services and the IEC tasks run concurrently, and most Arduino drivers for
// a shared peripheral are not safe from two tasks at once. Each lock serialises
// one peripheral; its users take it around each call into its driver:
//
//   network  A library that drives its chip directly (W5x00 Ethernet,
//            EthernetENC, WiFiNINA, WiFiS3), and any network object shared
//            between tasks (one MQTT client). OpenPLC's services take it only
//            where the core's stack is not thread-safe (OPLC_NET_LOCKED).
//   I2C      Wire (every instance).
//   SPI      SPI (every instance). Where the network chip sits on SPI, this IS
//            the network lock.
//   CAN      the CAN controller.
//   serial   one lock per serial port, keyed by the port object (&Serial2, a
//            SoftwareSerial, ...), held for a whole exchange: a request and its
//            reply, a modem command and its answer. OpenPLC's own ports (the
//            debugger's, the Modbus server's) are not for other code.
//
// OpenPLC's own services and function blocks take them already. A C/C++ block,
// an Arduino sketch or a third-party library using one of these peripherals
// must take the lock itself, declared weak so the same code links outside RTOS
// mode:
//
//     extern "C" void openplc_i2c_lock(void) __attribute__((weak));
//     extern "C" void openplc_i2c_unlock(void) __attribute__((weak));
//     if (openplc_i2c_lock) openplc_i2c_lock();
//     ... Wire ...
//     if (openplc_i2c_unlock) openplc_i2c_unlock();
//
// Rules: recursive (a wrapped call may reach another); hold a bus lock only for
// the driver calls themselves, a serial port's for its exchange, never across a
// wait of your own; and while holding one take no other OpenPLC lock. No-ops
// until plc_rtos_start().
extern "C" void openplc_net_lock(void);
extern "C" void openplc_net_unlock(void);
extern "C" void openplc_i2c_lock(void);
extern "C" void openplc_i2c_unlock(void);
extern "C" void openplc_spi_lock(void);
extern "C" void openplc_spi_unlock(void);
extern "C" void openplc_can_lock(void);
extern "C" void openplc_can_unlock(void);
extern "C" void openplc_serial_lock(void *port);
extern "C" void openplc_serial_unlock(void *port);

// The services' network lock: the network lock where the board's stack needs
// one (OPLC_NET_LOCKED, modbus_config.h), nothing where it does not. The try
// never waits: service A skips its network half for that pass rather than hold
// up the serial port behind a PLC task holding the network.
void plc_rtos_service_net_lock(void);
void plc_rtos_service_net_unlock(void);
bool plc_rtos_service_net_try_lock(void);

#ifdef __cplusplus
// Holds one of the locks above for a scope.
class PlcRtosHold {
public:
    typedef void (*fn_t)(void);
    PlcRtosHold(fn_t lock, fn_t unlock) : unlock_(unlock) { lock(); }
    ~PlcRtosHold() { unlock_(); }
    PlcRtosHold(const PlcRtosHold &) = delete;
    PlcRtosHold &operator=(const PlcRtosHold &) = delete;

private:
    fn_t unlock_;
};
// OPENPLC_HOLD(i2c) holds the I2C lock to the end of the enclosing block;
// OPENPLC_SERVICE_NET_HOLD() the services' network lock.
#define OPENPLC_HOLD(bus) PlcRtosHold openplc_hold_##bus(openplc_##bus##_lock, openplc_##bus##_unlock)
#define OPENPLC_SERVICE_NET_HOLD() \
    PlcRtosHold openplc_hold_service_net(plc_rtos_service_net_lock, plc_rtos_service_net_unlock)
#endif

// ---- Task statistics (FC 0x4E) -----------------------------------------------
//
// Encoded into `out` (big-endian, versioned) from task `first`, as many tasks as
// fit; the reply gives the task total, so a reader fetches the rest page by
// page. `reset` restarts the statistics window once the page holding the last
// task has been read. Returns the bytes written.
size_t plc_rtos_encode_stats(uint8_t *out, size_t capacity, uint8_t first, bool reset);

#endif // OPENPLC_RTOS

#endif // OPENPLC_PLC_RTOS_H
