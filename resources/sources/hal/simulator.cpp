// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
// Simulator HAL: the simulator has no pins and no I/O. Located variables keep the values the program and the
// debugger give them, like unlocated ones.

#include <stdint.h>

extern "C" {
#include "openplc.h"
}
#include "Arduino.h"
#include "defines.h"

uint8_t pinMask_DIN[1] = {0};
uint8_t pinMask_AIN[1] = {0};
uint8_t pinMask_DOUT[1] = {0};
uint8_t pinMask_AOUT[1] = {0};

extern "C" uint8_t set_hardware_pwm(uint8_t, float, float);

void hardwareInit() {}

uint8_t set_hardware_pwm(uint8_t, float, float)
{
    return 0;
}

void updateInputBuffers() {}

void updateOutputBuffers() {}
