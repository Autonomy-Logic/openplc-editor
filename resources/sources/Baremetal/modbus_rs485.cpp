// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#include "modbus_rs485.h"

#if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
#include "Controllino.h"
#endif

void mb_rs485_init(Stream *port, int16_t pin)
{
    if (pin >= 0)
    {
        pinMode(pin, OUTPUT);
        digitalWrite(pin, LOW);
    }

#if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
    if (port == &Serial3)
        Controllino_RS485Init();
#elif defined(CONTROLLINO_MICRO)
    if (port == &Serial2)
    {
        pinMode(CUSTOM_RS485_DEFAULT_DE_PIN, OUTPUT);
        pinMode(CUSTOM_RS485_DEFAULT_RE_PIN, OUTPUT);
        digitalWrite(CUSTOM_RS485_DEFAULT_DE_PIN, LOW);
        digitalWrite(CUSTOM_RS485_DEFAULT_RE_PIN, HIGH);
    }
#else
    (void)port;
#endif
}

void mb_rs485_pin(int16_t pin, bool transmit)
{
    if (pin >= 0)
        digitalWrite(pin, transmit ? HIGH : LOW);
}

void mb_rs485_board(Stream *port, bool transmit)
{
#if defined(CONTROLLINO_MAXI) || defined(CONTROLLINO_MEGA)
    if (port == &Serial3)
    {
        if (transmit)
            Controllino_RS485TxEnable();
        else
            Controllino_RS485RxEnable();
    }
#elif defined(CONTROLLINO_MICRO)
    if (port == &Serial2)
    {
        digitalWrite(CUSTOM_RS485_DEFAULT_DE_PIN, transmit ? HIGH : LOW);
        digitalWrite(CUSTOM_RS485_DEFAULT_RE_PIN, transmit ? HIGH : LOW);
    }
#else
    (void)port;
    (void)transmit;
#endif
}
