// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Autonomy®

#include "modbus_pdu.h"
#include "modbus_registers.h"
#include "modbus_debug.h"

// Derived per function code, exactly as process_mbpacket() below parses the
// fields — the single source of truth for the RTU frame shape.
int32_t mb_pdu_request_len(const uint8_t *f, uint16_t n)
{
    if (n < 2) return 0;
    switch (f[1])
    {
        case MB_FC_READ_COILS:
        case MB_FC_READ_INPUT_STAT:
        case MB_FC_READ_REGS:
        case MB_FC_READ_INPUT_REGS:
        case MB_FC_WRITE_COIL:
        case MB_FC_WRITE_REG:
            return 8;
        case MB_FC_WRITE_COILS:
        case MB_FC_WRITE_REGS:
            if (n < 7) return 0;
            return 9 + (int32_t)f[6];
        case MB_FC_DEBUG_INFO:
            return 4;
        case MB_FC_DEBUG_GET:
            return 9;
        case MB_FC_DEBUG_GET_LIST:
            if (n < 4) return 0;
            return 6 + 3 * (int32_t)(((uint16_t)f[2] << 8) | f[3]);
        case MB_FC_DEBUG_SET:
            if (n < 8) return 0;
            return 10 + (int32_t)(((uint16_t)f[6] << 8) | f[7]);
        case MB_FC_DEBUG_GET_MD5:
            return 8;
        case MB_FC_DEBUG_GET_STATUS:
        case MB_FC_DEBUG_GET_VERSION:
        case MB_FC_DEBUG_GET_DEVICE_ID:
        case MB_FC_DEBUG_READ_LICENSE:
            return 4;
        case MB_FC_DEBUG_WRITE_LICENSE:
            if (n < 4) return 0;
            return 6 + (int32_t)(((uint16_t)f[2] << 8) | f[3]);
        case MB_FC_PLC_SET_STATE:
            return 5;
        case MB_FC_REBOOT_BOOTLOADER:
            return 8;
        case MB_FC_GET_LOCK_STATE:
            return 4;
        default:
            return -1;
    }
}

int32_t mb_pdu_response_len(uint8_t fc, uint16_t quantity)
{
    switch (fc)
    {
        case MB_FC_READ_COILS:
        case MB_FC_READ_INPUT_STAT:
            if (quantity == 0 || quantity > 2000) return -1;
            return 5 + (int32_t)((quantity + 7u) / 8u);
        case MB_FC_READ_REGS:
        case MB_FC_READ_INPUT_REGS:
            if (quantity == 0 || quantity > 125) return -1;
            return 5 + 2 * (int32_t)quantity;
        case MB_FC_WRITE_COIL:
        case MB_FC_WRITE_REG:
            return 8;
        case MB_FC_WRITE_COILS:
            if (quantity == 0 || quantity > 1968) return -1;
            return 8;
        case MB_FC_WRITE_REGS:
            if (quantity == 0 || quantity > 123) return -1;
            return 8;
        default:
            return -1;
    }
}

// True for the debug FCs, whose RTU frames skip CRC.
bool mb_pdu_skips_crc(uint8_t fc)
{
    switch (fc)
    {
        case MB_FC_DEBUG_INFO:
        case MB_FC_DEBUG_SET:
        case MB_FC_DEBUG_GET:
        case MB_FC_DEBUG_GET_LIST:
        case MB_FC_DEBUG_GET_MD5:
        case MB_FC_DEBUG_GET_STATUS:
        case MB_FC_DEBUG_GET_VERSION:
        case MB_FC_DEBUG_GET_DEVICE_ID:
        case MB_FC_DEBUG_WRITE_LICENSE:
        case MB_FC_DEBUG_READ_LICENSE:
            return true;
        default:
            return false;
    }
}

// The editor's function codes as a contiguous range.
bool mb_pdu_is_editor_fc(uint8_t fc)
{
    return fc >= MB_FC_DEBUG_INFO && fc <= MB_FC_GET_LOCK_STATE;
}

void process_mbpacket()
{
    uint8_t fcode  = mb_frame[1];

    {
        const int32_t rtu_len = mb_pdu_request_len(mb_frame, (uint16_t)(mb_frame_len + 2));
        if (rtu_len > 0 && (int32_t)mb_frame_len < rtu_len - 2)
        {
            mb_frame[1] = fcode | 0x80;
            mb_frame[2] = MB_EX_ILLEGAL_VALUE;
            mb_frame_len = 3;
            return;
        }
    }
#ifdef MODBUS_ENABLED
    uint16_t field1 = (uint16_t)mb_frame[2] << 8 | (uint16_t)mb_frame[3];
    uint16_t field2 = (uint16_t)mb_frame[4] << 8 | (uint16_t)mb_frame[5];
#endif
    void *endianness_check = &mb_frame[2];

    switch (fcode)
    {
#ifdef MODBUS_ENABLED
        case MB_FC_WRITE_REG:
            writeSingleRegister(field1, field2);
        break;

        case MB_FC_READ_REGS:
            readRegisters(field1, field2);
        break;

        case MB_FC_WRITE_REGS:
            writeMultipleRegisters(field1, field2, mb_frame[6]);
        break;

        case MB_FC_READ_COILS:
            readCoils(field1, field2);
        break;

        case MB_FC_READ_INPUT_STAT:
            readInputStatus(field1, field2);
        break;

        case MB_FC_READ_INPUT_REGS:
            readInputRegisters(field1, field2);
        break;

        case MB_FC_WRITE_COIL:
            writeSingleCoil(field1, field2);
        break;

        case MB_FC_WRITE_COILS:
            writeMultipleCoils(field1, field2, mb_frame[6]);
        break;
#endif

        case MB_FC_DEBUG_INFO:
            debugInfo();
        break;

        case MB_FC_DEBUG_GET:
        {
            uint8_t arr       = mb_frame[2];
            uint16_t startIdx = (uint16_t)mb_frame[3] << 8 | (uint16_t)mb_frame[4];
            uint16_t endIdx   = (uint16_t)mb_frame[5] << 8 | (uint16_t)mb_frame[6];
            debugGetTrace(arr, startIdx, endIdx);
        }
        break;

        case MB_FC_DEBUG_GET_LIST:
        {
            uint16_t numIndexes = (uint16_t)mb_frame[2] << 8 | (uint16_t)mb_frame[3];
            debugGetTraceList(numIndexes, &mb_frame[4]);
        }
        break;

        case MB_FC_DEBUG_SET:
        {
            uint8_t arr   = mb_frame[2];
            uint16_t elem = (uint16_t)mb_frame[3] << 8 | (uint16_t)mb_frame[4];
            uint8_t flag  = mb_frame[5];
            uint16_t len  = (uint16_t)mb_frame[6] << 8 | (uint16_t)mb_frame[7];
            void *value   = &mb_frame[8];
            debugSetTrace(arr, elem, flag, len, value);
        }
        break;

        case MB_FC_DEBUG_GET_MD5:
            debugGetMd5(endianness_check);
        break;

        case MB_FC_DEBUG_GET_STATUS:
            debugGetStatus();
        break;

        case MB_FC_DEBUG_GET_VERSION:
            debugGetVersion();
        break;

        case MB_FC_DEBUG_GET_DEVICE_ID:
            debugGetDeviceId();
        break;

        case MB_FC_DEBUG_WRITE_LICENSE:
        {
            uint16_t lic_len = (uint16_t)mb_frame[2] << 8 | (uint16_t)mb_frame[3];
            debugWriteLicense(lic_len, &mb_frame[4]);
        }
        break;

        case MB_FC_DEBUG_READ_LICENSE:
            debugReadLicense();
        break;

        case MB_FC_PLC_SET_STATE:
            plcSetState(mb_frame[2]);
        break;

        case MB_FC_REBOOT_BOOTLOADER:
            rebootToBootloader(&mb_frame[2]);
        break;

        case MB_FC_GET_LOCK_STATE:
            getLockState();
        break;

        default:
            exceptionResponse(fcode, MB_EX_ILLEGAL_FUNCTION);
    }
}
