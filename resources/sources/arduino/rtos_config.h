// rtos_config.h — placeholder stub.
//
// The editor overwrites this file with OPENPLC_RTOS 1 for a build that runs in
// RTOS mode: a board whose Arduino core has an RTOS the firmware supports, with
// the board's RTOS switch on (see `generate-rtos-config.ts`). It stays as-is on
// every other build.
//
// It exists so the runtime can `#include "rtos_config.h"` unconditionally: with
// OPENPLC_RTOS at 0 everything RTOS mode adds compiles to nothing, so the
// single-loop firmware is unchanged by it.

#ifndef RTOS_CONFIG_H
#define RTOS_CONFIG_H

#define OPENPLC_RTOS 0

#endif // RTOS_CONFIG_H
