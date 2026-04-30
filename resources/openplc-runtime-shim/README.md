# OpenPLC Runtime v4 Shim

Static C-linkage shim that the editor packages into the project upload zip
under `core/generated/runtime_v4_entry.{cpp,h}` when targeting the OpenPLC
Runtime v4 (Linux). Together with the STruC++ runtime headers (under
`resources/strucpp/runtime/include/`, downloaded by `scripts/download-binaries.ts`),
it produces a `.so` whose symbol surface matches what `image_tables.c` /
`debug_handler.c` in `openplc-runtime` dlsym at load time.

This file is identical for every project — there is no per-project code
generation. The companion file in `openplc-runtime` is at
`core/strucpp_runtime_template/runtime_v4_entry.cpp`. Keep the two in sync
when changing the .so contract.

See also: `docs/strucpp-migration/05-runtime-v4-so-interface.md`.

## TODO (editor side)

`src/backend/editor/compiler/compiler-module.ts` does not yet bundle these
files for v4 uploads. When Phase 5 is wired into the editor pipeline, the
v4 upload step should:

1. Copy `resources/openplc-runtime-shim/runtime_v4_entry.cpp` →
   `<bundle>/core/generated/runtime_v4_entry.cpp`
2. Copy `resources/openplc-runtime-shim/runtime_v4_entry.h` →
   `<bundle>/core/generated/runtime_v4_entry.h`
3. Copy `resources/strucpp/runtime/include/` →
   `<bundle>/core/generated/strucpp_runtime/include/`

(The runtime's `compile.sh` expects this layout; see `scripts/compile.sh`
in the openplc-runtime repo on the `strucpp-migration` branch.)
