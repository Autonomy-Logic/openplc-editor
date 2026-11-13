# Modbus master header tests

- `generate-modbus-master-header.test.ts`: the generator, its field validation and the AS-05 abuse scenario.
- `firmware-abi.test.ts`: the skeleton stub `modbus_master_config.h` and the record types in
  `modbus_master_types.h`, read as text from the firmware sources.
- `host-compile.test.ts`: the stub and the generated headers of its fixtures compile with
  `modbus_master_types.h` and a `HardwareSerial` stand-in, through
  `g++ -std=gnu++11 -fsyntax-only`. It needs `g++` on the host, so it is skipped unless
  `MB_MASTER_HOST_COMPILE=1` is set.

Run the host compile locally from the repository root:

```sh
# openplc-editor
MB_MASTER_HOST_COMPILE=1 npx jest --config jest.config.json --no-coverage src/frontend/utils/modbus-master/__tests__/host-compile.test.ts

# openplc-web
MB_MASTER_HOST_COMPILE=1 npx vitest run --config vitest.config.ts src/frontend/utils/modbus-master/__tests__/host-compile.test.ts
```
