// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®
// modbus_master_config.h: Modbus master stub with the master off; the editor replaces it on a
// baremetal build with Modbus remote devices (generate-modbus-master-header.ts).
#ifndef MODBUS_MASTER_CONFIG_H
#define MODBUS_MASTER_CONFIG_H

#define MB_MASTER_ENABLED 0
#define MB_MASTER_TCP_ENABLED 0
#define MB_MASTER_RTU_ENABLED 0
#define MB_MASTER_ENDPOINT_COUNT 0
#define MB_MASTER_BUS_COUNT 0
#define MB_MASTER_DEVICE_COUNT 0
#define MB_MASTER_GROUP_COUNT 0
#define MB_MASTER_POINT_COUNT 0

#endif // MODBUS_MASTER_CONFIG_H
