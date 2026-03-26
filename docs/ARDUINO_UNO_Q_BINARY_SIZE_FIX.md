# Arduino Uno Q Binary Size Optimization

## Problem Discovery

### Symptoms
OpenPLC programs compiled for Arduino Uno Q would upload successfully but fail to execute - no LED blinking, no serial output, despite the same code working on Arduino Mega and the same board working with Arduino IDE sketches.

### Root Cause Analysis

Through extensive debugging using OpenOCD via ADB shell, we traced the failure to the Zephyr LLEXT (Linkable Loadable Extensions) loader. The exact failure point was identified:

```
llext_load() returns 0xfffffff4 (-12 = ENOMEM)
```

The Arduino Uno Q uses a dual-processor architecture:
- **Qualcomm QRB2210** - Linux MPU (host)
- **STM32U585** - Zephyr MCU (runs Arduino sketches via LLEXT)

The Zephyr firmware is configured with `CONFIG_LLEXT_HEAP_SIZE=128` (128KB). The OpenPLC-generated binary was **241KB** - nearly twice the heap limit.

### Binary Size Comparison

| Binary | Size |
|--------|------|
| Simple Arduino IDE sketch | ~25 KB |
| OpenPLC blink program | ~241 KB |
| LLEXT heap limit | 128 KB |

## Root Cause: Code Duplication

Analysis with `arm-zephyr-eabi-nm` revealed the problem:

1. **582 IEC function blocks** were compiled into the binary
2. Each function appeared **4 times** at different addresses
3. Functions like `TON_init__`, `TON_body__`, `SM_16DIN_init__` were duplicated

The duplication occurred because:
1. `iec_std_FB.h` defines all IEC function blocks as `static` functions
2. This header is included by 4 different `.c` files: `Res0.c`, `Config0.c`, `glueVars.c`, and `POUS.c` (via `POUS.h`)
3. Since `static` functions have internal linkage, each translation unit gets its own copy
4. The linker cannot deduplicate them

Additionally, hardware-specific modules (P1AM, Click PLC SM_CARDS, etc.) were unconditionally included even when not needed.

## Solution

### 1. Conditional Module Includes (`iec_std_FB.h`)

Added `#ifdef` guards around hardware-specific function block includes:

```c
#ifdef USE_P1AM_BLOCKS
#include "p1am_FB.h"
#endif

#ifdef USE_SM_BLOCKS
#include "sm_cards.h"
#endif

#ifdef USE_MQTT_BLOCKS
#include "MQTT.h"
#endif
// etc.
```

### 2. Single-Compilation Function Definitions (`iec_std_FB.h`)

Restructured the header to compile function bodies only once:

```c
#ifndef IEC_STD_FB_IMPL
// Extern declarations for when implementations are not included
extern void TON_init__(TON *data__, BOOL retain);
extern void TON_body__(TON *data__);
// ... all other function declarations
#else
// Function definitions - compiled only once
void TON_init__(TON *data__, BOOL retain) {
    // implementation
}
// ... all other function definitions
#endif
```

### 3. Template Update (`glueVars.c.j2`)

Modified the glueVars.c template to define `IEC_STD_FB_IMPL`:

```c
// Include IEC function block implementations in this file only.
// Other files get only type definitions to avoid code duplication.
#define IEC_STD_FB_IMPL
#include "iec_std_lib.h"
```

This ensures only `glueVars.c` compiles the function bodies, while other files get extern declarations.

## Results

| Stage | Total Size | .text Section | Function Count |
|-------|-----------|---------------|----------------|
| Original | 241 KB | 233 KB | 582 (4× duplicates) |
| After module guards | 140 KB | 132 KB | 374 |
| **After deduplication** | **56 KB** | **49 KB** | **98 (unique)** |

**77% size reduction** - well under the 128KB LLEXT heap limit.

## Files Modified

### openplc-editor
- `resources/sources/MatIEC/lib/iec_std_FB.h` - Added conditional compilation guards and extern declarations

### xml2st
- `templates/glueVars.c.j2` - Added `#define IEC_STD_FB_IMPL`

## Why Arduino Mega Worked

The Arduino Mega (8-bit AVR) uses a different build process:
- AVR-GCC performs more aggressive dead code elimination
- The `.hex` file contains only final linked code after unused symbols are stripped
- No dynamic loading - code is flashed directly to MCU

The Zephyr LLEXT system loads the entire relocatable ELF into heap memory for dynamic linking, making binary size critical.

## Testing

After applying these fixes:
1. Binary size reduced to 56KB (well under 128KB limit)
2. LED blinks correctly on Arduino Uno Q
3. No regressions observed on other Arduino boards

## Future Considerations

1. Consider making the `USE_*_BLOCKS` macros automatically defined based on PLC program analysis
2. Further optimization could include dead code elimination for unused standard function blocks
3. The same optimization benefits all Arduino targets, not just Uno Q
