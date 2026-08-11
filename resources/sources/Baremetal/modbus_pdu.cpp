/*
modbus_pdu.cpp - Transport-agnostic Modbus PDU dispatch + per-FC frame shape
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#include "modbus_pdu.h"
#include "modbus_registers.h"
#include "modbus_debug.h"

// Derived per function code, exactly as process_mbpacket() below parses the
// fields — the single source of truth for the RTU frame shape.
int32_t mb_pdu_request_len(const uint8_t *f, uint16_t n)
{
    if (n < 2) return 0;                                // need at least id + FC
    switch (f[1])
    {
        case MB_FC_READ_COILS:
        case MB_FC_READ_INPUT_STAT:
        case MB_FC_READ_REGS:
        case MB_FC_READ_INPUT_REGS:
        case MB_FC_WRITE_COIL:
        case MB_FC_WRITE_REG:
            return 8;                                   // [id][fc][a:2][b:2][crc:2]
        case MB_FC_WRITE_COILS:
        case MB_FC_WRITE_REGS:
            if (n < 7) return 0;                        // byte count lives at f[6]
            return 9 + (int32_t)f[6];                   // + [bc:1][data:bc][crc:2]
        case MB_FC_DEBUG_INFO:
            return 4;                                   // [id][fc][crc:2]
        case MB_FC_DEBUG_GET:
            return 9;                                   // [id][fc][arr:1][s:2][e:2][crc:2]
        case MB_FC_DEBUG_GET_LIST:
            if (n < 4) return 0;                        // count lives at f[2..3]
            return 6 + 3 * (int32_t)(((uint16_t)f[2] << 8) | f[3]);
        case MB_FC_DEBUG_SET:
            if (n < 8) return 0;                         // value len lives at f[6..7]
            return 10 + (int32_t)(((uint16_t)f[6] << 8) | f[7]);
        case MB_FC_DEBUG_GET_MD5:
            return 8;                                   // [id][fc][endian:2][00:2][crc:2]
        case MB_FC_DEBUG_GET_STATUS:
        case MB_FC_DEBUG_GET_VERSION:
        case MB_FC_DEBUG_GET_BOARD_ID:
        case MB_FC_DEBUG_READ_LICENSE:
            return 4;                                   // [id][fc][crc:2]
        case MB_FC_DEBUG_WRITE_LICENSE:
            if (n < 4) return 0;                        // len (BE) lives at f[2..3]
            // [id][fc][len:2][blob:len][crc:2] -> overhead 6 + blob len.
            // NOTE: len is BIG-ENDIAN on the wire (blob content is little-endian).
            return 6 + (int32_t)(((uint16_t)f[2] << 8) | f[3]);
        case MB_FC_PLC_SET_STATE:
            return 5;                                   // [id][fc][state:1][crc:2]
        default:
            return -1;                                  // not one of our function codes
    }
}

// The debug FCs are private, well-formed and performance-sensitive, so their RTU
// frames skip CRC. Keep this list in lockstep with the DEBUG cases below and in
// mb_pdu_request_len above.
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
        case MB_FC_DEBUG_GET_BOARD_ID:
        case MB_FC_DEBUG_WRITE_LICENSE:
        case MB_FC_DEBUG_READ_LICENSE:
            return true;
        default:
            return false;
    }
}

void process_mbpacket()
{
    uint8_t fcode  = mb_frame[1];
#ifdef MODBUS_ENABLED
    // Standard Modbus fields — only used by the operation FCs, which are
    // compiled out in debug-only builds (so guard to avoid unused-var warnings).
    uint16_t field1 = (uint16_t)mb_frame[2] << 8 | (uint16_t)mb_frame[3];
    uint16_t field2 = (uint16_t)mb_frame[4] << 8 | (uint16_t)mb_frame[5];
#endif
    void *endianness_check = &mb_frame[2];

    switch (fcode)
    {
#ifdef MODBUS_ENABLED
        // Standard Modbus operation FCs read/write the coil/register buffers,
        // which only exist when full Modbus is enabled. In debug-only builds
        // these cases are compiled out, so operation requests fall through to
        // the default and get an ILLEGAL_FUNCTION exception.
        case MB_FC_WRITE_REG:
            //field1 = reg, field2 = value
            writeSingleRegister(field1, field2);
        break;

        case MB_FC_READ_REGS:
            //field1 = startreg, field2 = numregs
            readRegisters(field1, field2);
        break;

        case MB_FC_WRITE_REGS:
            //field1 = startreg, field2 = status
            writeMultipleRegisters(field1, field2, mb_frame[6]);
        break;

        case MB_FC_READ_COILS:
            //field1 = startreg, field2 = numregs
            readCoils(field1, field2);
        break;

        case MB_FC_READ_INPUT_STAT:
            //field1 = startreg, field2 = numregs
            readInputStatus(field1, field2);
        break;

        case MB_FC_READ_INPUT_REGS:
            //field1 = startreg, field2 = numregs
            readInputRegisters(field1, field2);
        break;

        case MB_FC_WRITE_COIL:
            //field1 = reg, field2 = status
            writeSingleCoil(field1, field2);
        break;

        case MB_FC_WRITE_COILS:
            //field1 = startreg, field2 = numoutputs
            writeMultipleCoils(field1, field2, mb_frame[6]);
        break;
#endif // MODBUS_ENABLED

        case MB_FC_DEBUG_INFO:
            debugInfo();
        break;

        case MB_FC_DEBUG_GET:
        {
            // PDU: [FC:1][arr:u8][start_elem:u16][end_elem:u16]
            uint8_t arr       = mb_frame[2];
            uint16_t startIdx = (uint16_t)mb_frame[3] << 8 | (uint16_t)mb_frame[4];
            uint16_t endIdx   = (uint16_t)mb_frame[5] << 8 | (uint16_t)mb_frame[6];
            debugGetTrace(arr, startIdx, endIdx);
        }
        break;

        case MB_FC_DEBUG_GET_LIST:
        {
            // PDU: [FC:1][count:u16][(arr:u8, elem:u16)×count]
            uint16_t numIndexes = (uint16_t)mb_frame[2] << 8 | (uint16_t)mb_frame[3];
            debugGetTraceList(numIndexes, &mb_frame[4]);
        }
        break;

        case MB_FC_DEBUG_SET:
        {
            // PDU: [FC:1][arr:u8][elem:u16][force:u8][len:u16][value...]
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

        case MB_FC_DEBUG_GET_BOARD_ID:
            debugGetBoardId();
        break;

        case MB_FC_DEBUG_WRITE_LICENSE:
        {
            // PDU: [FC:1][len:u16 BE][blob...]
            // len is BIG-ENDIAN (same convention as GET_LIST/SET); the blob
            // CONTENT it carries is little-endian.
            uint16_t lic_len = (uint16_t)mb_frame[2] << 8 | (uint16_t)mb_frame[3];
            debugWriteLicense(lic_len, &mb_frame[4]);
        }
        break;

        case MB_FC_DEBUG_READ_LICENSE:
            debugReadLicense();
        break;

        case MB_FC_PLC_SET_STATE:
            // PDU: [FC:1][state:u8]  (0 = STOP, 1 = RUN)
            plcSetState(mb_frame[2]);
        break;


        default:
            exceptionResponse(fcode, MB_EX_ILLEGAL_FUNCTION);
    }
}
