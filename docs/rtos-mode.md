# RTOS mode

Normally the Baremetal firmware runs everything in one loop: each PLC task, then
Modbus, then the debugger, one after another. If one function block has to wait
(say a network `connect()` to a host that is down), the whole PLC waits with it.

RTOS mode fixes that. On boards whose Arduino core has a real-time operating
system (RTOS), each PLC task runs on a thread of its own, and Modbus, the
debugger, OPC-UA and S7 run on threads of their own too. A block that waits
now holds up only its own task. The task model is the same as OpenPLC
Runtime v4's.

## Which boards

| Boards | RTOS | Most tasks |
|---|---|---|
| Every ESP32 (incl. Arduino Nano ESP32) | FreeRTOS | 8 |
| Pico, Pico W, Pico 2, Pico 2 W (ARM and RISC-V) | FreeRTOS SMP (both cores) | 8 |
| Nano 33 BLE, Nano RP2040 Connect, Giga | Mbed OS | 8 |
| Uno Q, Ventuno Q | Zephyr | 8 |
| STM32 (Blackpill, Nucleo, ...) except the F1 and Cortex-M0/M0+ families | FreeRTOS (installed with the build) | 4 |
| Uno R4 Minima, Uno R4 WiFi | FreeRTOS | 1 |
| Zero, MKR WiFi 1010, MKR Zero, Nano 33 IoT | FreeRTOS (installed with the build) | 2 |

RTOS mode needs more than 30 KB of RAM. Smaller boards always build the single
loop: every AVR, the STM32 F1 (the Blue Pill) and the Cortex-M0/M0+ STM32
families (F0, L0, G0, C0, U0, WB0, WL3).

On the Uno R4 there is room for one task, so a waiting block still holds up the
PLC there. What RTOS mode still gives it: the debugger and Modbus keep
answering, because they run on their own thread.

Tested on hardware: ESP32-S3, ESP32 (Wi-Fi and a W5500), Raspberry Pi Pico, and
the Nano RP2040 Connect's Mbed OS build run on a Pico. The other boards are
compile-tested.

**When the tasks share one thread.** With an older STruC++ release, RTOS mode
can run all of a project's tasks on one PLC thread instead of a thread each.
The tasks still run at their own intervals, and the debugger and Modbus still
have their own thread, but a block that waits holds up every task again, as in
the single loop. The build log says when this happens:

- **Every board but the ESP32** needs a STruC++ with the platform threads hook
  (`STRUCPP_PLATFORM_THREADS`) to give each task its own thread.
- **A global I/O array** (or a global of your own data type mapped to I/O),
  such as eight outputs declared as one variable,
  `outputs AT %QX0.0 : ARRAY[0..7] OF BOOL`, needs a STruC++ with the global
  lock hooks, on every board. Mapping each I/O point to its own variable
  (`out0 AT %QX0.0 : BOOL`, ...) avoids it.

## Turning it on and off

RTOS mode is **on by default** on the boards above. **Board Settings → RTOS
mode** switches it off, and the board builds the classic single loop.

The switch shows whether it is at the **Board default** or **Set for this
board**. **Use the default** hands the choice back. The difference matters when
a project cannot run in RTOS mode (see below): on the default the build quietly
uses the single loop and says why; set by hand, the build stops and tells you.

## Writing a project for it

- **Put blocking blocks in a task of their own, at a lower priority** than the
  task that runs the machine. In IEC, priority 0 is the highest, so "lower
  priority" means a bigger number.
- **Use whole-millisecond intervals.** Tasks are released on the RTOS's 1 ms tick
  (0.1 ms on Zephyr). The task table marks an interval it cannot keep. An
  Interrupt task, which has no interval, runs every 20 ms.
- **Stay within the table's number of tasks.** Each task has its own thread and
  stack (16 KB, or 2 KB on the 32 KB boards). Put programs that belong together
  in the same task.
- **Let only one task write each global.** Each read or write of a global is
  safe from any task. With a STruC++ that has the global lock hooks, so is a
  statement that updates a global from itself (`count := count + 1`); an older
  one can lose such updates. An update spread over several statements is never
  safe: another task can change the global in between.
- **A global block instance is shared, not copied.** With the global lock
  hooks, a TON or other block declared in the resource's globals runs under
  its own lock for the whole call, so a task calling it waits while another
  task is inside it. An older STruC++ does not compile such a call.
- **Keep each network connection and each bus device in one task,** unless the
  library that drives it takes OpenPLC's lock (see the last section). A block
  instance or a socket used from two tasks at once can otherwise get corrupted.
  A DS18B20 (OneWire) pin must be read from one task only.
- **Leave OpenPLC's own serial ports alone:** the debugger's port and, if the
  Modbus server has one, its RS485 port. Anything written to them, even a debug
  `Serial.println`, breaks the frames the debugger or the Modbus master reads.

**Projects written for the single loop.** The single loop runs tasks one after
another, so two tasks updating the same global never interrupt each other. In
RTOS mode they can. Check such globals against the rules above, or switch RTOS
mode off for that board.

## What changes at run time

- **A task that runs past its interval** (an overrun) is skipped at its next
  release, never queued up. Overruns are counted. Timers keep real time.
- **The debugger and Modbus run below the PLC tasks** (on the Pico, on the other
  core), so a task waiting on a block never holds them up. On a single-core
  board, a task that computes non-stop for longer than its interval delays
  their answers until its scan ends; the other PLC tasks keep their timing.
- **The debugger reads** a task's variables between its scans, waiting up to
  100 ms for the current scan to end. A task stuck mid-scan (in a block that
  waits) is read as it stands, so a 64-bit value or a string may show
  half-updated. **Writing or forcing** a stuck task's variable answers *busy*
  until that scan ends. With the global lock hooks, a global is written under
  its own lock and answers *busy* only while a task holds it for more than
  100 ms, such as inside a global block that waits; without them a global can
  always be written.
- **Forced values** hold on inputs and outputs every cycle, over the hardware
  and over Modbus or S7 writes.
- **STOP** switches the outputs off at once, lets every task finish the scan it
  is in, saves retained values, then stops.
- **Retained values** are saved between scans. A task stuck in a block is saved
  as it stands, so it can never stop retain from being saved.
- **The Arduino sketch hook** (`sketch_setup`, `sketch_loop`), when a board
  package uses it, runs in the fastest task: `sketch_setup` before that task's
  first scan (the network is up by then), `sketch_loop` after each of its scans.
  It does not run while the PLC is stopped, and it must not write to the serial
  port the debugger uses.

## When a build uses the single loop instead

On the default setting, a project that cannot run in RTOS mode builds the
single loop, and the build log says why. That happens when:

- the tasks break the rules above (too many, an interval that is not whole
  milliseconds, more distinct priorities than the board has levels);
- the RTOS library could not be installed (for example, offline);
- the firmware does not fit the board's memory, either at link time or once the
  task stacks are counted against the free RAM;
- the RTOS build fails somewhere other than the project's own C/C++ code.

With the switch set by hand, each of these stops the build instead. The one
exception is the free-RAM count, which only warns: the board may then stop at
start-up in ERROR.

## Seeing what the board is doing

**Runtime Status** asks the board itself whether it runs RTOS mode (the
firmware on it may be an older build). A board in RTOS mode shows each task's
scan, cycle and latency times, overruns and stack margin, measured since the
screen opened. A task stuck in one scan is named, with how long it has been
stuck. A board running the single loop says so.

From the command line: `openplc-cli debug stats` (see `docs/CLI.md`).

## For block and library authors: sharing hardware between tasks

In RTOS mode, PLC tasks and the services run at the same time. Most Arduino
drivers (`Wire`, `SPI`, `Serial`, the W5x00 `Ethernet` library, ...) break if
two threads use them at once. So each shared peripheral has a lock, and every
piece of code that uses the peripheral holds its lock while it talks to it.

| Lock | Protects | OpenPLC takes it in |
|---|---|---|
| `openplc_net_lock` | network libraries that drive their chip directly (W5x00 `Ethernet`, `EthernetENC`, `WiFiNINA`, the Uno R4's `WiFiS3`), and any network object shared between tasks | Modbus TCP, OPC-UA, S7, discovery, the MQTT and Arduino Cloud blocks |
| `openplc_i2c_lock` | `Wire` (every instance) | the Sequent Microsystems card blocks |
| `openplc_spi_lock` | `SPI` (every instance; where the network chip is on SPI, this is also the network lock) | the P1AM blocks |
| `openplc_can_lock` | the CAN controller | the Arduino CAN and STM32 CAN blocks |
| `openplc_serial_lock(port)` | one serial port, with a lock for each port, whatever its kind (`Serial1`, `SoftwareSerial`, a Pico PIO UART, USB serial) | not needed: OpenPLC's own serial ports are reserved for OpenPLC, so no other code shares them |

OpenPLC's own blocks already take these. **Your own C/C++ blocks, sketches and
third-party libraries must take them too** when they use one of these
peripherals. Copy this into your code (the I2C lock shown; the network, SPI and
CAN locks work the same way, and serial ports are below):

```cpp
// OpenPLC's I2C lock. It only exists in RTOS mode; everywhere else the calls
// below are skipped, so the same code builds and runs on every target.
// extern "C": the lock is a plain C function. Leave it out and C++ looks for a
// different name, never finds it, and silently skips the lock.
extern "C" void openplc_i2c_lock(void) __attribute__((weak));
extern "C" void openplc_i2c_unlock(void) __attribute__((weak));

// Holds the I2C lock until the end of the enclosing block.
struct OpenPlcI2cHold {
    OpenPlcI2cHold()  { if (openplc_i2c_lock) openplc_i2c_lock(); }
    ~OpenPlcI2cHold() { if (openplc_i2c_unlock) openplc_i2c_unlock(); }
};

uint8_t read_expander(void)
{
    OpenPlcI2cHold hold;              // released when the function returns
    Wire.beginTransmission(0x20);
    Wire.write(0x09);
    Wire.endTransmission(false);
    Wire.requestFrom(0x20, 1);
    return Wire.read();
}
```

`__attribute__((weak))` means "use this function if the program has one". Only
an RTOS-mode build has the locks, so the same code does the right thing
everywhere:

| Where it runs | Locks present? | What the code above does |
|---|---|---|
| Baremetal, RTOS mode | yes | takes the lock, so two tasks never use the bus at once |
| Baremetal, single loop | no | skips it; everything runs one after another anyway |
| OpenPLC Runtime v4 (Linux) | no | skips it; the library still builds and runs |

Runtime v4 also runs each task on a thread of its own, but it has no OpenPLC
locks. The network is already thread-safe on Linux. A library that shares one
object between tasks there (one MQTT client, say) must protect it itself, for
example with a `std::mutex`.

Rules for holding a lock:

- Hold it only around the driver calls, for a whole exchange (a write and the
  read that answers it), and never while you wait for something else.
- While you hold one lock, do not take another.
- The locks are recursive: code that already holds one can take it again.

### Serial ports: RS485, Modbus RTU, modems

A serial port carries one conversation at a time: the device at the other end
cannot tell two senders apart. So a serial port's lock is held for a whole
exchange: a Modbus RTU or BeeBus request *and* its reply, an AT command to a
GSM modem *and* its answer. Blocks that share a port (in the same task or in
different tasks) then take turns, one exchange each, and tasks using other
ports are never held up.

Each port has its own lock, found by the port object itself, so it works for
every kind of port without OpenPLC knowing your board's ports:

```cpp
// OpenPLC's serial port locks: one per port, found by the port object. They
// only exist in RTOS mode; everywhere else the calls below are skipped.
extern "C" void openplc_serial_lock(void *port) __attribute__((weak));
extern "C" void openplc_serial_unlock(void *port) __attribute__((weak));

// Holds a serial port's lock until the end of the enclosing block.
struct OpenPlcSerialHold {
    void *port;
    explicit OpenPlcSerialHold(void *p) : port(p) { if (openplc_serial_lock) openplc_serial_lock(port); }
    ~OpenPlcSerialHold() { if (openplc_serial_unlock) openplc_serial_unlock(port); }
};

String modem_command(const char *command)
{
    OpenPlcSerialHold hold(&Serial2);   // the command and its answer
    Serial2.println(command);
    return Serial2.readStringUntil('\n');
}
```

- **Pass the port object itself**, `&Serial2`, the same way everywhere. That
  is what identifies the port; a library that only keeps a `Stream &` passes
  `&stream`, which is the same object.
- **A modem (GSM, LTE)** is reached only through its serial port, so that
  port's lock covers everything: AT commands, SMS, and the sockets of a client
  that runs over the modem.
- **An exchange can take seconds** (a slow slave, a modem command). Any other
  task that needs the same port waits that long, so put the blocks that share a
  slow port in the same task, or in a task that can afford to wait.
- **OpenPLC's own ports are not shared.** The debugger's port and the Modbus
  server's RS485 port belong to OpenPLC; use another port for your devices.

**Network locks and the services.** Where the core's network stack is already
safe from any thread (lwIP on the ESP32 and the Pico W, Mbed OS, Zephyr),
OpenPLC's services do not take the network lock, so a block waiting on a
connection never slows Modbus TCP, OPC-UA or S7 down. The lock still exists
there for objects shared between tasks. With a chip from the table, a block
holding the lock makes Modbus TCP, OPC-UA and S7 wait, and the serial port too
if a Modbus TCP request was being answered when the block took the lock. On the
32 KB boards one lock covers every bus and serial port.

## For maintainers

- How it works inside the firmware: the RTOS section of
  `resources/sources/Baremetal/ARCHITECTURE.md`.
- Firmware code: `Baremetal/plc_rtos.*` (dispatcher, tasks, services,
  statistics, the lock API in `plc_rtos.h`), `Baremetal/plc_os.cpp` and
  `arduino/plc_os.h` (one backend per RTOS), and the RTOS section of
  `arduino/arduino_runtime_glue.cpp` (process image, scan locks).
- Which cores support it: `src/middleware/shared/utils/rtos/support.ts`.
- Adding an RTOS: a `RtosBackend` in `rtos/types.ts`, its entry and core row in
  `support.ts`, its macro in `steps/generate-rtos-config.ts`, its priorities in
  `plc_os.h` and its backend in `plc_os.cpp`.
- Per-task statistics travel as Modbus function code `0x4E`, a page of tasks per
  request.
