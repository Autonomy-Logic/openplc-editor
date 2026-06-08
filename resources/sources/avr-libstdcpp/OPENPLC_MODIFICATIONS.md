# OpenPLC Editor fork of modm-io/avr-libstdcpp

This is a vendored copy of [modm-io/avr-libstdcpp](https://github.com/modm-io/avr-libstdcpp)
with two small additions required for STruC++ generated code to compile on Arduino's
AVR GCC 7.3 toolchain.

## Upstream

- Repository: https://github.com/modm-io/avr-libstdcpp
- License: GPLv3 with GCC Runtime Library Exception (see `COPYING3` and `COPYING.MPLv2`)
- Clone date: kept in sync with STruC++ runtime requirements

## Modifications

### 1. Added `include/string` (stub)

Upstream intentionally excludes `<string>` because `std::string` requires heap + exceptions,
neither appropriate for AVR. STruC++ generated code `#include`s `<string>` unconditionally
in its header preamble but never actually uses `std::string` (it uses its own stack-allocated
`IECString<N>` template). The stub file is empty — it just satisfies the include directive.

### 2. Added `strtoll` / `strtoull` shims in `include/cstdlib`

AVR libc does not provide 64-bit string conversion functions. STruC++'s `iec_string.hpp`
uses `std::strtoll`/`std::strtoull` for IEC `LINT`/`ULINT` STRING conversions. Added inline
shims inside `namespace std` that fall back to 32-bit `strtol`/`strtoul`. See the `#ifdef
__AVR__` block at the end of `cstdlib`.

## Usage

Added to the compiler's include path via `-I` (NOT `-isystem`) when compiling for AVR
boards. The Arduino AVR GCC 7.3 preprocessor has a bug where `-isystem` headers are
treated as C-linkage, causing "template with C linkage" errors. Using `-I` avoids this.

See `src/backend/editor/compiler/compiler-module.ts` `handleCompileArduinoProgram()`.
