// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
/*
license_config.h - Build switch for the open board-ID layer.

LIC_PLATFORM_ENABLED is 0 when the board's VPP links its own copy of the layer
(VPP_HAS_LICENSE_CORE in defines.h), so the open files compile to nothing.
*/
#ifndef LICENSE_CONFIG_H
#define LICENSE_CONFIG_H

#if defined(ARDUINO) && defined(__has_include)
#if __has_include("defines.h")
#include "defines.h"
#endif
#endif

#if defined(VPP_HAS_LICENSE_CORE)
#define LIC_PLATFORM_ENABLED 0
#else
#define LIC_PLATFORM_ENABLED 1
#endif

#endif /* LICENSE_CONFIG_H */
