# Modbus master header tests

- `generate-modbus-master-header.test.ts`: the generator, its field validation and the AS-05 abuse scenario.
- `firmware-abi.test.ts`: the skeleton stub `modbus_master_config.h` and the record types in
  `modbus_master_types.h`, read as text from the firmware sources.
- `host-compile.test.ts`: the stub and the generated headers of its fixtures compile with
  `modbus_master_types.h` and a `HardwareSerial` stand-in, through
  `g++ -std=gnu++11 -fsyntax-only`. It needs `g++` on the host, so it is skipped unless
  `MB_MASTER_HOST_COMPILE=1` is set.
- `firmware-master-sources.test.ts`: the master modules ship, name no network class (only `baremetal_net`
  does), never touch `mb_frame`, and no firmware source resolves a host name or carries a pending-work marker.
  Read as text; runs everywhere.
- `firmware-master-gates.test.ts`: the build gates, through the host C preprocessor (`g++ -E`) with every
  Arduino and network library header replaced by an empty stand-in. `baremetal_net.h` opens for a TCP master
  and stays closed for an RTU-only master or the stub; a NINA board takes `WiFiNINA.h`; `Baremetal.ino` calls
  `mb_master_task()` from `scheduler()` and `loop()` before the forces, maps the empty buffers for a master-only
  build, and calls nothing of the master with the stub. Skipped unless `MB_MASTER_HOST_COMPILE=1` is set.
- `firmware-master-rtu-sources.test.ts`: the RTU master and the RS-485 helper ship; the RTU master calls no
  `flush()`, `delayMicroseconds()` or `delay()`, never touches `mb_frame`, `mb_rx_*` or the frame-bound
  `calcCrc()`, and includes `modbus_crc.h`; the server and the master both include `modbus_rs485.h`, which
  includes no upper-layer header and carries every CONTROLLINO RS-485 call and pin, gone from
  `modbus_serial.cpp`. Read as text; runs everywhere.
- `firmware-master-rtu-gates.test.ts`: through `g++ -E` like the gates above, `Baremetal.ino` with an RTU-only
  master runs `mb_master_task()` from `scheduler()` and `loop()` before the forces and maps the empty buffers;
  `modbus_rs485` keeps the CONTROLLINO MAXI and MEGA calls on `Serial3`, the MICRO DE and RE pins on
  `Serial2`, and neither on another board. Skipped unless `MB_MASTER_HOST_COMPILE=1` is set.

Run the host checks locally from the repository root:

```sh
# openplc-editor
MB_MASTER_HOST_COMPILE=1 npx jest --config jest.config.json --no-coverage src/frontend/utils/modbus-master/__tests__/host-compile.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-gates.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-rtu-gates.test.ts

# openplc-web
MB_MASTER_HOST_COMPILE=1 npx vitest run --config vitest.config.ts src/frontend/utils/modbus-master/__tests__/host-compile.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-gates.test.ts src/frontend/utils/modbus-master/__tests__/firmware-master-rtu-gates.test.ts
```
