#include <cstdint>
#include <cstring>

#ifdef ARDUINO
#include <Arduino.h>
// Arduino.h defines min(a,b) and max(a,b) as 2-arg macros that collide
// with std::min / std::max templates in <algorithm> (pulled in
// transitively by iec_string.hpp below). Undef so the strucpp runtime
// headers parse cleanly — standard Arduino+STL idiom.
#undef min
#undef max
#endif

// Static baseline — compiled by arduino-cli in the core's native C++
// standard (gnu++11 on AVR, gnu++14 on mbed/Renesas, etc.), so it MUST
// stay free of strucpp template-heavy headers. The typedefs below are
// plain C — no namespace, no templates — and parse in every supported
// standard. When the user's project declares C/C++ blocks, the editor
// instead emits the dynamic version under <build>/<board>/src/, where
// the pre-compile pipeline picks it up with -std=gnu++17 and links it
// into the precompiled OpenPLCUserLib archive.

/*********************/
/*  IEC Types defs   */
/*********************/

typedef uint8_t  IEC_BOOL;

typedef int8_t    IEC_SINT;
typedef int16_t   IEC_INT;
typedef int32_t   IEC_DINT;
typedef int64_t   IEC_LINT;

typedef uint8_t    IEC_USINT;
typedef uint16_t   IEC_UINT;
typedef uint32_t   IEC_UDINT;
typedef uint64_t   IEC_ULINT;

typedef uint8_t    IEC_BYTE;
typedef uint16_t   IEC_WORD;
typedef uint32_t   IEC_DWORD;
typedef uint64_t   IEC_LWORD;

typedef float    IEC_REAL;
typedef double   IEC_LREAL;

#ifndef STR_MAX_LEN
#define STR_MAX_LEN 126
#endif

#ifndef STR_LEN_TYPE
#define STR_LEN_TYPE int8_t
#endif

typedef STR_LEN_TYPE __strlen_t;
// Raw STRING/WSTRING layout used in the auto-generated struct *and* by
// the C++ stub's flat staging (see frontend/utils/cpp/generateSTCode.ts).
// Matches what the user's c_blocks code expects via `name.len` /
// `name.body[]`. This intentionally shadows nothing — the generated
// struct refers to it unqualified, the strucpp wrapper as `strucpp::`.
typedef struct {
    __strlen_t len;
    uint8_t body[STR_MAX_LEN];
} IEC_STRING;
typedef IEC_STRING IEC_WSTRING;
