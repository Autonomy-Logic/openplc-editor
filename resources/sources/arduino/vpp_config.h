// vpp_config.h — placeholder stub for non-VPP arduino-cli boards.
//
// VPP-enabled boards (Arduino Opta, P1AM, etc., declared `vppIo: true`
// in their package manifest) have this file overwritten at compile
// time by the editor's `generateVppConfigContent` step, populated with
// per-board configuration-screen #defines.
//
// Non-VPP boards leave this stub in place: HAL drivers can `#include
// "vpp_config.h"` unconditionally without needing per-target gating
// (the stub guarantees the include resolves; the macros it would
// define just aren't present, so any `#ifdef VPP_…` blocks compile
// out cleanly).

#ifndef VPP_CONFIG_H
#define VPP_CONFIG_H

// No VPP configuration is baked into this build.

#endif // VPP_CONFIG_H
