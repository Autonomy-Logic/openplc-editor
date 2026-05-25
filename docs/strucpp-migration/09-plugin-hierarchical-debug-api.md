# Phase 9: Plugin Migration to Hierarchical Debug API

> **New phase** added during the implementation review. Phase 5 deletes
> the legacy flat-index variable API
> (`get_var_count` / `get_var_size` / `get_var_addr` / `get_var_list`)
> from `plugin_runtime_args_t`, which breaks any plugin that consumed
> it. This phase migrates those plugins onto the hierarchical
> `(arr_idx, elem_idx)` API the editor and runtime already speak,
> and re-enables them.

## Goal

Migrate every plugin that historically referenced PLC variables by flat
`uint16_t` index onto the same `(arr_idx, elem_idx)` addressing
the editor's debugger uses, with `debug-map.json` providing the
path↔(arr, elem) translation. Once migrated, plugins resume working
under the new runtime without any wrapper layer in between.

## Prerequisites

- Phase 5 (runtime → C++; flat-index API removed) — defines what's
  being migrated away from
- The editor is already producing `debug-map.json` at compile time
  (Phase 4 work)

## Affected Plugins

| Plugin | Where it consumed the flat API | Notes |
|---|---|---|
| **OPC UA** (Python, `core/src/drivers/plugins/python/opcua/`) | `opcua_memory.py:get_var_list/get_var_sizes_batch` etc., via the Python `plugin_runtime_args_t` ctypes binding | Primary consumer. Whole point of the plugin: expose all PLC variables to OPC UA clients. |
| Anything else? | Unknown — `safe_buffer_access_refactored.py` and `debug_utils.py` in the shared Python plugin layer also reference `get_var_count` / `get_var_list` / `get_var_size`. Audit needed when work starts. |  |

S7Comm, EtherCAT, Modbus master/slave, etc. operate on **located
variables** through the image-table buffer pointers — they don't go
through the variable-index API at all and are unaffected by this
phase.

## What the Old API Provided

```c
// plugin_runtime_args_t (deleted in Phase 5)

void     (*get_var_list) (size_t num_vars, size_t *indexes, void **result);
size_t   (*get_var_size) (size_t idx);
uint16_t (*get_var_count)(void);
```

Plugins called these with flat `uint16_t` indices and got back raw
pointers into the IECVar's underlying storage (or into MatIEC's
`debug_vars[]` table back in the day). They could then read/write
through those pointers as if they were ordinary PLC variables.

In the OPC UA flow, the plugin built a `Path → flat_index` map at
startup (the editor used to ship a map file alongside the program), and
each OPC UA client read/write call resolved through that map and into
`get_var_addr`.

## What the New API Provides

The runtime exposes the same hierarchical debug surface the editor uses:

```c
// dlsym'd from the loaded .so:

uint8_t  strucpp_debug_array_count(void);
uint16_t strucpp_debug_elem_count(uint8_t arr);
uint16_t strucpp_debug_size(uint8_t arr, uint16_t elem);
uint8_t  strucpp_debug_set(uint8_t arr, uint16_t elem,
                           bool forcing,
                           const uint8_t *bytes, uint16_t len);
uint16_t strucpp_debug_read(uint8_t arr, uint16_t elem, uint8_t *dest);
```

The path↔(arr, elem) translation lives in `debug-map.json`, generated
by STruC++ at compile time. Schema (informal):

```json
{
  "version": 2,
  "md5": "abc123...",
  "typeTags": { "BOOL": 0, "INT": 3, "DINT": 5, ... },
  "leaves": [
    {
      "arrayIdx": 0,
      "elemIdx": 0,
      "path": "MAINPROG.COUNTER",
      "type": "INT",
      "size": 2
    },
    ...
  ]
}
```

The plugin reads this file at startup, builds its own
`map<string, (arr, elem)>` (or `map<int_id, (arr, elem)>` if it's
mapping OPC UA NodeIDs etc.), and uses the strucpp_debug_* surface for
every read/write.

## Plugin Runtime Args — New Surface

The runtime exposes the strucpp_debug_* helpers to plugins through
function pointers in `plugin_runtime_args_t` so plugins don't have to
dlsym them themselves:

```c
// plugin_types.h (additions; removed fields shown for context)

typedef struct {
    /* ... existing image-table pointers, mutex, journal helpers ... */

    /* REMOVED in Phase 5: */
    // void     (*get_var_list)(...);
    // size_t   (*get_var_size)(size_t);
    // uint16_t (*get_var_count)(void);

    /* NEW: hierarchical debug surface */
    uint8_t  (*debug_array_count)(void);
    uint16_t (*debug_elem_count) (uint8_t arr);
    uint16_t (*debug_size)       (uint8_t arr, uint16_t elem);
    uint8_t  (*debug_set)        (uint8_t arr, uint16_t elem,
                                  bool forcing, const uint8_t *bytes, uint16_t len);
    uint16_t (*debug_read)       (uint8_t arr, uint16_t elem, uint8_t *dest);

    /* Path to debug-map.json — plugins that need path→(arr, elem) lookup
     * read this file themselves. */
    const char *debug_map_path;     // typically "./debug-map.json" relative to runtime cwd
} plugin_runtime_args_t;
```

The runtime populates `debug_*` pointers with the dlsym'd function
addresses during plugin initialization, and `debug_map_path` from
the build directory layout.

## Python Plugin Bridge

The OPC UA plugin is Python; ctypes is the bridge. The shared Python
helpers (`debug_utils.py`, `safe_buffer_access_refactored.py`) wrap the
raw function pointers into pythonic helpers. After migration:

```python
# Pseudocode for the migrated wrapper

class HierarchicalDebugAccess:
    def __init__(self, args: PluginRuntimeArgs):
        self._args = args
        with open(args.debug_map_path) as f:
            self._map = json.load(f)
        self._path_to_addr = {
            leaf["path"]: (leaf["arrayIdx"], leaf["elemIdx"])
            for leaf in self._map["leaves"]
        }
        self._addr_to_size = {
            (leaf["arrayIdx"], leaf["elemIdx"]): leaf["size"]
            for leaf in self._map["leaves"]
        }

    def read_path(self, path: str) -> bytes:
        arr, elem = self._path_to_addr[path]
        size = self._addr_to_size[(arr, elem)]
        buf = (c_uint8 * size)()
        n = self._args.debug_read(arr, elem, buf)
        return bytes(buf[:n])

    def write_path(self, path: str, value: bytes, forcing: bool = False):
        arr, elem = self._path_to_addr[path]
        status = self._args.debug_set(arr, elem, forcing, value, len(value))
        if status != STATUS_OK:
            raise RuntimeError(f"debug_set failed: 0x{status:02x}")
```

Real implementation needs to handle:

- Type-aware encoding (an `INT` is 2 bytes little-endian, a `BOOL` is
  1 byte, a `REAL` is 4 bytes IEEE 754, etc.). The `typeTags` table
  in `debug-map.json` plus the existing per-tag size handling already
  covers this — it's the same logic the editor uses in its debugger.
- MD5 verification: the plugin should compare `debug-map.json`'s
  embedded MD5 against the value the runtime returns from FC 0x45 (or
  via `plc_program_md5`) to detect stale maps. On mismatch, refuse to
  start and log a clear error.
- Reload on program change: the plugin manager already restarts plugins
  on program upload; the wrapper just needs to re-read `debug-map.json`
  during its `init` callback, not memoize it across uploads.

## Discovery: What Variables Does the Plugin Expose?

The OPC UA plugin used to walk the flat index range `[0,
get_var_count())` and add every variable to the OPC UA address space.
With hierarchical addressing, the equivalent walk is over the
`leaves` array in `debug-map.json` — one OPC UA node per leaf, named
by `path`, typed by `type`. The plugin no longer needs to call
`get_var_count` / `get_var_size` at runtime; everything it needs is in
the JSON.

## Forcing Semantics

`strucpp_debug_set(arr, elem, forcing=true, bytes, len)` forces the
variable to the supplied value. `strucpp_debug_set(arr, elem,
forcing=false, NULL, 0)` unforces it. This is the **same call** the
editor's debugger uses — the protocol is symmetric, and the OPC UA
plugin can offer "force this variable" semantics to its clients with
zero runtime-side help.

## Migration Strategy

1. **Stage 1: re-enable the plugin in stub mode.** Restore plugin
   loading; the plugin starts up but every read returns 0 / write
   silently fails. Logs `"OPC UA plugin running in stub mode pending
   migration"`. This validates the plugin manager pipeline still works
   end-to-end.
2. **Stage 2: implement the wrapper.** `HierarchicalDebugAccess` (or its
   equivalent) reads `debug-map.json`, validates MD5 against
   `plc_program_md5`, builds the path map. Wire one read path through it
   end-to-end (e.g., a single `BOOL` exposed to OPC UA, read from a
   client).
3. **Stage 3: full type coverage.** Extend the wrapper to all type tags
   (`BOOL`, `SINT`...`LREAL`, time types). Use the editor's existing
   per-tag encoders/decoders as the reference.
4. **Stage 4: writes + forcing.** Validate that OPC UA writes hit
   `debug_set` with `forcing=false`, and that explicit "force" actions
   from clients hit `debug_set` with `forcing=true`.
5. **Stage 5: regression coverage.** Run the existing OPC UA plugin
   integration tests against the migrated wrapper; expect zero behavior
   change from a client's perspective.

Each stage is independently shippable. Stages 1–2 unblock developers
running the runtime locally; stages 3–5 are the productionization.

## Files Modified

| File | Action |
|------|--------|
| `core/src/drivers/plugin_types.h` | Add `debug_*` function pointers and `debug_map_path` to `plugin_runtime_args_t` |
| `core/src/drivers/plugin_driver.cpp` | Populate the new fields during plugin initialization |
| `core/src/drivers/plugins/python/shared/plugin_runtime_args.py` | Update the ctypes shape to match the new struct |
| `core/src/drivers/plugins/python/shared/debug_utils.py` | Replace flat-index helpers with `HierarchicalDebugAccess`-style wrapper |
| `core/src/drivers/plugins/python/shared/safe_buffer_access_refactored.py` | Same |
| `core/src/drivers/plugins/python/opcua/opcua_memory.py` | Use `HierarchicalDebugAccess` instead of the flat helpers |
| `core/src/drivers/plugins/python/opcua/synchronization.py` | Same |
| Tests under `tests/` for the affected plugins | Updated to load a real `debug-map.json` rather than mocking the flat helpers |

## Testing Strategy

1. **Stub-mode startup**: confirm OPC UA plugin loads, opens its
   server port, accepts connections, returns dummy values without
   crashing. The runtime's plugin lifecycle remains stable.
2. **Single-variable read**: with the wrapper wired up, expose one
   `BOOL` to OPC UA. Client reads the value, sees it change when the
   PLC program toggles it.
3. **Type coverage**: 1 of each type — `BOOL`, `INT`, `DINT`, `REAL`,
   `STRING`, `TIME` — and verify each round-trips correctly.
4. **MD5 mismatch**: deliberately upload a program but drop in a
   stale `debug-map.json`. Plugin refuses to start with a clear log
   line. The runtime keeps running; user can re-upload.
5. **Force from OPC UA**: a client invokes the OPC UA "set value"
   with the force flag; the PLC program subsequently `set()`s the
   variable but the value remains forced (matches editor-side
   forcing semantics).
6. **Concurrency**: 100 OPC UA clients reading 1000 variables each
   while the PLC program runs at 1 ms cycles. No torn reads, no
   crashes, OPC UA latency stays bounded.
