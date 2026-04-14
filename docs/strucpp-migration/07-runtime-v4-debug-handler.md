# Phase 7: Runtime v4 Native Hierarchical Debug

## Goal

Update the Runtime v4's `debug_handler.c` to natively use hierarchical `(program_idx, var_idx)`
addressing when communicating with the editor, eliminating the flat-index lookup table from
Phase 5. This is the final cleanup phase -- it can be done after Phase 5 is stable.

## Prerequisites

- Phase 5 (v4_compat.cpp with working C-linkage debug interface)
- Phase 4 (debugger design -- at least the protocol portion)

## Current State After Phase 5

Phase 5 provides backward-compatible debug access through `flat_var_table[]`:

```
Editor (v2 protocol) <--> Editor adapter (converts v2 -> v1) <--> Runtime debug_handler (v1)
                                                                      |
                                                                  flat_var_table (v4_compat.cpp)
                                                                      |
                                                                  STruC++ IECVar variables
```

This works but has an unnecessary translation layer. Phase 7 removes it:

```
Editor (v2 protocol) <--> Runtime debug_handler (v2) <--> STruC++ IECVar variables
```

## Step 8.1: New .so Debug Symbols

**File to modify**: `src/backend/shared/utils/PLC/generate-v4-compat.ts`

Add hierarchical debug symbols to `v4_compat.cpp`:

```cpp
// =============================================================================
// Hierarchical debug interface (native v2 protocol)
// =============================================================================

extern "C" uint8_t strucpp_get_program_count(void) {
    return PROGRAM_COUNT;
}

extern "C" uint16_t strucpp_get_var_count_for_program(uint8_t prog_idx) {
    if (prog_idx >= PROGRAM_COUNT) return 0;
    return program_var_counts[prog_idx];
}

extern "C" uint8_t strucpp_get_var_size_h(uint8_t prog_idx, uint16_t var_idx) {
    if (prog_idx >= PROGRAM_COUNT) return 0;
    if (var_idx >= program_var_counts[prog_idx]) return 0;
    return debug_sizes[prog_idx][var_idx];
}

extern "C" bool strucpp_get_var_value(uint8_t prog_idx, uint16_t var_idx, void* dest) {
    if (prog_idx >= PROGRAM_COUNT) return false;
    if (var_idx >= program_var_counts[prog_idx]) return false;

    debug_get_fn fn = debug_get_fns[prog_idx][var_idx];
    if (fn) {
        fn(dest);
        return true;
    }
    // Array: copy first element
    memcpy(dest, debug_ptrs[prog_idx][var_idx], debug_sizes[prog_idx][var_idx]);
    return true;
}

extern "C" bool strucpp_get_array_element(uint8_t prog_idx, uint16_t var_idx,
                                           uint16_t elem_idx, void* dest) {
    if (prog_idx >= PROGRAM_COUNT) return false;
    if (var_idx >= program_var_counts[prog_idx]) return false;
    uint16_t arr_size = debug_array_sizes[prog_idx][var_idx];
    if (arr_size == 0 || elem_idx >= arr_size) return false;

    uint8_t elem_size = debug_sizes[prog_idx][var_idx];
    size_t stride = elem_size * 2 + 1;  // IECVar<T> stride
    uint8_t* base = (uint8_t*)debug_ptrs[prog_idx][var_idx];
    memcpy(dest, base + elem_idx * stride, elem_size);
    return true;
}

extern "C" bool strucpp_set_var_trace(uint8_t prog_idx, uint16_t var_idx,
                                       bool forced, void* val) {
    if (prog_idx >= PROGRAM_COUNT) return false;
    if (var_idx >= program_var_counts[prog_idx]) return false;

    debug_force_fn fn = debug_force_fns[prog_idx][var_idx];
    if (!fn) return false;
    fn(forced, val);
    return true;
}

extern "C" uint16_t strucpp_get_array_size(uint8_t prog_idx, uint16_t var_idx) {
    if (prog_idx >= PROGRAM_COUNT) return 0;
    if (var_idx >= program_var_counts[prog_idx]) return 0;
    return debug_array_sizes[prog_idx][var_idx];
}
```

## Step 8.2: Update Runtime Symbol Resolution

**File to modify**: `openplc-runtime/core/src/plc_app/image_tables.c`

Add optional symbol resolution for hierarchical debug:

```c
// Optional STruC++ hierarchical debug symbols
static uint8_t (*ext_strucpp_get_program_count)(void) = NULL;
static uint16_t (*ext_strucpp_get_var_count_for_program)(uint8_t) = NULL;
static uint8_t (*ext_strucpp_get_var_size_h)(uint8_t, uint16_t) = NULL;
static bool (*ext_strucpp_get_var_value)(uint8_t, uint16_t, void*) = NULL;
static bool (*ext_strucpp_get_array_element)(uint8_t, uint16_t, uint16_t, void*) = NULL;
static bool (*ext_strucpp_set_var_trace)(uint8_t, uint16_t, bool, void*) = NULL;
static uint16_t (*ext_strucpp_get_array_size)(uint8_t, uint16_t) = NULL;

void symbols_init_strucpp_debug(PluginManager* pm) {
    *(void**)&ext_strucpp_get_program_count =
        plugin_manager_get_func(pm, ..., "strucpp_get_program_count");
    *(void**)&ext_strucpp_get_var_count_for_program =
        plugin_manager_get_func(pm, ..., "strucpp_get_var_count_for_program");
    *(void**)&ext_strucpp_get_var_size_h =
        plugin_manager_get_func(pm, ..., "strucpp_get_var_size_h");
    *(void**)&ext_strucpp_get_var_value =
        plugin_manager_get_func(pm, ..., "strucpp_get_var_value");
    *(void**)&ext_strucpp_get_array_element =
        plugin_manager_get_func(pm, ..., "strucpp_get_array_element");
    *(void**)&ext_strucpp_set_var_trace =
        plugin_manager_get_func(pm, ..., "strucpp_set_var_trace");
    *(void**)&ext_strucpp_get_array_size =
        plugin_manager_get_func(pm, ..., "strucpp_get_array_size");
}

bool has_strucpp_debug(void) {
    return ext_strucpp_get_program_count != NULL;
}
```

## Step 8.3: Update Debug Handler

**File to modify**: `openplc-runtime/core/src/plc_app/debug_handler.c`

The `process_debug_data()` function dispatches debug commands. Update it to detect v2
protocol and use hierarchical symbols:

```c
int process_debug_data(uint8_t* frame, uint16_t frame_len, uint8_t* resp, uint16_t* resp_len) {
    uint8_t function_code = frame[0];

    // Detect protocol version from request format
    // v2 requests have a version byte or different structure

    if (has_strucpp_debug()) {
        return process_debug_data_v2(frame, frame_len, resp, resp_len);
    } else {
        return process_debug_data_v1(frame, frame_len, resp, resp_len);
    }
}

// --- Protocol v2 handler ---
int process_debug_data_v2(uint8_t* frame, uint16_t frame_len,
                           uint8_t* resp, uint16_t* resp_len) {
    uint8_t function_code = frame[0];

    switch (function_code) {
    case 0x41:  // DEBUG_INFO
        return debugInfoV2(resp, resp_len);

    case 0x42:  // DEBUG_SET
        return debugSetTraceV2(frame, frame_len, resp, resp_len);

    case 0x43:  // DEBUG_GET (range)
        return debugGetTraceV2(frame, frame_len, resp, resp_len);

    case 0x44:  // DEBUG_GET_LIST (batch)
        return debugGetTraceListV2(frame, frame_len, resp, resp_len);

    case 0x45:  // DEBUG_GET_MD5
        return debugGetMd5(frame, frame_len, resp, resp_len);  // Unchanged

    default:
        resp[0] = function_code;
        resp[1] = 0x81;  // Error
        *resp_len = 2;
        return -1;
    }
}

// --- v2 handler implementations ---

int debugInfoV2(uint8_t* resp, uint16_t* resp_len) {
    resp[0] = 0x41;
    resp[1] = 0x7E;  // Success
    resp[2] = 2;     // Protocol version
    uint8_t prog_count = ext_strucpp_get_program_count();
    resp[3] = prog_count;

    uint16_t offset = 4;
    for (uint8_t p = 0; p < prog_count; p++) {
        uint16_t vc = ext_strucpp_get_var_count_for_program(p);
        resp[offset++] = (vc >> 8) & 0xFF;
        resp[offset++] = vc & 0xFF;
    }
    *resp_len = offset;
    return 0;
}

int debugSetTraceV2(uint8_t* frame, uint16_t frame_len,
                     uint8_t* resp, uint16_t* resp_len) {
    if (frame_len < 6) {
        resp[0] = 0x42;
        resp[1] = 0x81;
        *resp_len = 2;
        return -1;
    }

    uint8_t  prog_idx = frame[1];
    uint16_t var_idx  = ((uint16_t)frame[2] << 8) | frame[3];
    bool     force    = frame[4] != 0;
    uint8_t  val_len  = frame[5];
    void*    val_ptr  = (val_len > 0) ? &frame[6] : NULL;

    bool ok = ext_strucpp_set_var_trace(prog_idx, var_idx, force, val_ptr);

    resp[0] = 0x42;
    resp[1] = ok ? 0x7E : 0x81;
    *resp_len = 2;
    return ok ? 0 : -1;
}

int debugGetTraceListV2(uint8_t* frame, uint16_t frame_len,
                         uint8_t* resp, uint16_t* resp_len) {
    uint16_t count = ((uint16_t)frame[1] << 8) | frame[2];

    resp[0] = 0x44;
    resp[1] = 0x7E;

    // Tick counter
    extern uint32_t tick__;
    memcpy(&resp[2], &tick__, 4);

    uint16_t data_offset = 8;  // After header
    uint16_t req_offset = 3;   // After count field

    for (uint16_t i = 0; i < count && req_offset + 5 <= frame_len; i++) {
        uint8_t  prog_idx = frame[req_offset++];
        uint16_t var_idx  = ((uint16_t)frame[req_offset] << 8) | frame[req_offset + 1];
        req_offset += 2;
        uint16_t elem_idx = ((uint16_t)frame[req_offset] << 8) | frame[req_offset + 1];
        req_offset += 2;

        uint8_t sz = ext_strucpp_get_var_size_h(prog_idx, var_idx);

        if (elem_idx == 0xFFFF) {
            // Scalar read
            ext_strucpp_get_var_value(prog_idx, var_idx, &resp[data_offset]);
        } else {
            // Array element read
            ext_strucpp_get_array_element(prog_idx, var_idx, elem_idx, &resp[data_offset]);
        }
        data_offset += sz;

        // Prevent buffer overflow
        if (data_offset > 1400) break;  // Leave room for CRC/framing
    }

    // Data length
    uint16_t data_len = data_offset - 8;
    resp[6] = (data_len >> 8) & 0xFF;
    resp[7] = data_len & 0xFF;

    *resp_len = data_offset;
    return 0;
}
```

## Step 8.4: WebSocket Debug Transport

The Runtime v4 also supports WebSocket-based debugging (used by the editor's WebSocket
transport). The WebSocket handler in the runtime's Python webserver (`app.py`) currently
forwards debug commands to the PLC core via the Unix socket.

This path remains unchanged -- the debug PDU format change is transparent to the WebSocket
transport layer since it treats the PDU as opaque bytes.

## Design Notes

### Protocol Detection: v1 vs v2

The `has_strucpp_debug()` check is sufficient because:
- MatIEC .so files: don't export `strucpp_get_program_count` -> v1
- STruC++ .so files: always export it -> v2

There's no ambiguity. The editor and runtime must agree on the protocol version. The editor
detects it from `debug-map.json` (v2) vs `debug.c` (v1). The runtime detects it from
symbol availability. Both detection methods are deterministic and consistent.

### Removing the Flat-Index Table

After Phase 7 is deployed, the `flat_var_table[]` in `v4_compat.cpp` becomes dead code for
runtime targets (it's still used by the Arduino path in Phase 5's backward-compatible debug
layer). It can be conditionally compiled:

```cpp
#ifndef OPENPLC_RUNTIME_V4_NATIVE_DEBUG
// Flat index table for backward compatibility
static const FlatVarEntry flat_var_table[] = { ... };
extern "C" uint16_t get_var_count(void) { ... }
// ...
#endif
```

The old flat-index symbols (`get_var_count`, `get_var_addr`, etc.) should still be exported
for backward compatibility with older runtimes, but they can also use the hierarchical
internal implementation to avoid maintaining two code paths.

### Buffer Size Limits

Modbus PDUs have a maximum size (typically 256 bytes for RTU, 65535 for TCP). The batch
read handler (`debugGetTraceListV2`) must check that the response doesn't exceed the buffer:

```c
if (data_offset > 1400) break;  // Conservative limit
```

The editor should limit batch request sizes accordingly (e.g., request at most 50 variables
per batch for RTU, 200+ for TCP/WebSocket).

## Testing Strategy

1. **v2 protocol end-to-end**: Editor (Phase 4) connects to Runtime v4 (Phase 7)
   - Read scalar variables, verify correct values
   - Read array elements, verify correct values
   - Force a variable, verify persistence
   - Unforce, verify return to computed value

2. **Large project test**: Upload the sample project (~3,500 variables)
   - Verify debugInfoV2 returns correct program/variable counts
   - Verify batch reads of 50 variables complete in < 100ms

3. **Array scalability test**: Project with ARRAY[0..9999] OF INT
   - Verify only requested elements are transmitted
   - Verify no memory overflow in debug handler

4. **MatIEC fallback**: Upload a MatIEC-compiled program
   - Verify v1 debug handler is used
   - Verify all existing debug functionality works

5. **Mixed editor/runtime versions**: Old editor + new runtime, new editor + old runtime
   - Verify graceful fallback to the common protocol version

## Files Created/Modified

| File | Action |
|------|--------|
| `src/backend/shared/utils/PLC/generate-v4-compat.ts` | Modified -- add hierarchical debug symbols |
| `openplc-runtime/core/src/plc_app/debug_handler.c` | Modified -- v2 protocol handling |
| `openplc-runtime/core/src/plc_app/debug_handler.h` | Modified -- new function declarations |
| `openplc-runtime/core/src/plc_app/image_tables.c` | Modified -- resolve hierarchical symbols |
| `openplc-runtime/core/src/plc_app/image_tables.h` | Modified -- new extern declarations |
