#include "openplc.h"
#if defined(VPP_HAS_LICENSE_CORE)
// Weak fallback: boards whose HAL exposes raw hal_* but that link WITHOUT the
// license-core .a run unenforced (I/O passes through). The prebuilt license-core
// .a provides STRONG updateInput/OutputBuffers that override these and add the gate.
extern "C" __attribute__((weak)) void updateInputBuffers(void)  { hal_read_inputs(); }
extern "C" __attribute__((weak)) void updateOutputBuffers(void) { hal_write_outputs(); }
#endif
