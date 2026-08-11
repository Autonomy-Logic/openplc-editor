/*
modbus_debug.cpp - OpenPLC always-on debugger function codes (0x41-0x4B)
Copyright (C) 2022 OpenPLC - Thiago Alves
*/

#include "modbus_debug.h"
#include "license_store.h"   // license_store_read/write + lic_status_to_mb
// Debug surface comes via the extern "C" shims in arduino_runtime_glue.h
// (openplc_debug_*, scan_counter) so this TU stays free of strucpp's
// template-heavy headers and compiles cleanly under arduino-cli's default C++
// standard. The shims forward to strucpp::debug::handle_* inside
// arduino_runtime_glue.cpp (part of the precompiled OpenPLCUserLib archive).
#include "arduino_runtime_glue.h"
// PLC_STATE_* / PLC_SWITCH_* and runtime_get_plc_state(), for the run/stop
// reporting in debugGetStatus() and plcSetState().
#include "openplc.h"
#include "openplc_version.h"

// ArduinoUniqueID (ricaun) backs the DEBUG_GET_BOARD_ID (0x48) function code.
// It supports AVR/megaAVR/SAM/SAMD/STM32/ESP/RP2040/Teensy. On a core without
// support (or when a board intentionally opts out via OPENPLC_NO_UNIQUE_ID),
// the board-id handler returns id_len = 0 instead of failing to compile.
#ifndef OPENPLC_NO_UNIQUE_ID
    #include <ArduinoUniqueID.h>
    #define OPENPLC_HAS_UNIQUE_ID
#endif

/**
 * @brief Sends a Modbus response frame for the DEBUG_INFO function code.
 *
 * This function constructs a Modbus response frame for the DEBUG_INFO function code.
 * The response frame includes the number of variables defined in the PLC program.
 *
 * Modbus Response Frame (DEBUG_INFO):
 * +-----+-------+-------+
 * | MB  | Count | Count |
 * | FC  |       |       |
 * +-----+-------+-------+
 * |0x41 | High  | Low   |
 * |     | Byte  | Byte  |
 * |     |       |       |
 * +-----+-------+-------+
 *
 * @return void
 */
// Phase 4 PDU:
// +-----+-------+------+-----------+-----------+-----------+
// | FC  | arrs  | stat | count_0   | count_1   | ...       |
// |0x41 | (u8)  | (u8) | (u16 BE)  | (u16 BE)  |           |
// +-----+-------+------+-----------+-----------+-----------+
// Response: [FC, arrCount, STATUS_OK, (count×arrCount as u16 BE)]
void debugInfo()
{
    uint8_t arrCount = openplc_debug_array_count();

    // Cap at what the Modbus frame can hold: 3 header bytes + 2 bytes/array.
    // Realistic projects have <=10 arrays, so this is never a real limit.
    uint8_t maxArrs = (MAX_MB_FRAME - 3) / 2;
    if (arrCount > maxArrs) arrCount = maxArrs;

    mb_frame[1] = MB_FC_DEBUG_INFO;
    mb_frame[2] = arrCount;
    mb_frame[3] = MB_DEBUG_SUCCESS;
    uint16_t pos = 4;
    for (uint8_t i = 0; i < arrCount; i++)
    {
        uint16_t c = openplc_debug_elem_count(i);
        mb_frame[pos++] = (uint8_t)(c >> 8);
        mb_frame[pos++] = (uint8_t)(c & 0xFF);
    }
    mb_frame_len = pos;
}

/**
 * @brief Sends a Modbus response frame for the DEBUG_SET function code.
 *
 * This function constructs a Modbus response frame for the DEBUG_SET function code.
 * The response frame indicates whether the set trace command was successful or if
 * there was an error, such as an out-of-bounds index.
 *
 * Modbus Response Frame (DEBUG_SET):
 * +-----+------+
 * | MB  | Resp.|
 * | FC  | Code |
 * +-----+------+
 * |0x42 | Code |
 * +-----+------+
 *
 * @param varidx The index of the variable to set trace for.
 * @param flag The trace flag.
 * @param len The length of the trace data.
 * @param value Pointer to the trace data.
 *
 * @return void
 */
// Phase 4 PDU: [FC, arr, elem_hi, elem_lo, force, len_hi, len_lo, value...]
// Response:    [FC, STATUS]
void debugSetTrace(uint8_t arr, uint16_t elem, uint8_t flag,
                   uint16_t len, void *value)
{
    if (len > (MAX_MB_FRAME - 8))
    {
        mb_frame_len = 3;
        mb_frame[1] = MB_FC_DEBUG_SET;
        mb_frame[2] = MB_DEBUG_ERROR_OUT_OF_BOUNDS;
        return;
    }

    uint8_t status = openplc_debug_set(
        arr, elem, (uint8_t)flag, (const uint8_t *)value, len);

    mb_frame_len = 3;
    mb_frame[1] = MB_FC_DEBUG_SET;
    mb_frame[2] = status;
}

/**
 * @brief Sends a Modbus response frame for the DEBUG_GET function code.
 *
 * This function constructs a Modbus response frame for the DEBUG_GET function code.
 * The response frame includes the trace data for variables within the specified index range.
 *
 * Modbus Response Frame (DEBUG_GET):
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 * | MB  | Resp. | Last  | Last  | Tick  | Tick  | Tick  | Tick  | Resp. | Resp.| Data  |
 * | FC  | Code  | Index | Index |       |       |       |       | Size  | Size | Bytes |
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 * |0x44 | Code  | High  | Low   | High  | Mid   | Mid   | Low   | High  | Low  | Data  |
 * |     |       | Byte  | Byte  | Byte  | Byte  | Byte  | Byte  | Byte  | Byte | Bytes |
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 *
 * @param startidx The start index of the variables to get trace for.
 * @param endidx The end index of the variables to get trace for.
 *
 * @return void
 */
// Phase 4 PDU: [FC, arr, start_hi, start_lo, end_hi, end_lo]
// Response: [FC, STATUS, last_elem_hi, last_elem_lo,
//            tick_hi, tick_mh, tick_ml, tick_lo,
//            size_hi, size_lo, data...]
void debugGetTrace(uint8_t arr, uint16_t startidx, uint16_t endidx)
{
    uint16_t arrCount = openplc_debug_elem_count(arr);
    if (arrCount == 0 || startidx >= arrCount ||
        endidx >= arrCount || startidx > endidx)
    {
        mb_frame_len = 3;
        mb_frame[1] = MB_FC_DEBUG_GET;
        mb_frame[2] = MB_DEBUG_ERROR_OUT_OF_BOUNDS;
        return;
    }

    uint16_t lastElemIdx = startidx;
    uint16_t responseSize = 0;
    uint8_t *responsePtr = &(mb_frame[11]);

    for (uint16_t elem = startidx; elem <= endidx; elem++)
    {
        uint16_t varSize = openplc_debug_size(arr, elem);
        // Bounds check — stop packing if this one won't fit.
        if ((11 + responseSize + varSize) > MAX_MB_FRAME) break;
        if (varSize == 0) {
            // Entry has no readable bytes (string stub / out-of-bounds)
            // — skip gracefully to keep the scan progressing.
            lastElemIdx = elem;
            continue;
        }
        uint16_t n = openplc_debug_read(arr, elem, responsePtr);
        if (n == 0) {
            lastElemIdx = elem;
            continue;
        }
        responsePtr += n;
        responseSize += n;
        lastElemIdx = elem;
    }

    mb_frame_len = 11 + responseSize;
    mb_frame[1] = MB_FC_DEBUG_GET;
    mb_frame[2] = MB_DEBUG_SUCCESS;
    mb_frame[3] = (uint8_t)(lastElemIdx >> 8);
    mb_frame[4] = (uint8_t)(lastElemIdx & 0xFF);
    mb_frame[5] = (uint8_t)((scan_counter >> 24) & 0xFF);
    mb_frame[6] = (uint8_t)((scan_counter >> 16) & 0xFF);
    mb_frame[7] = (uint8_t)((scan_counter >> 8)  & 0xFF);
    mb_frame[8] = (uint8_t)(scan_counter & 0xFF);
    mb_frame[9]  = (uint8_t)(responseSize >> 8);
    mb_frame[10] = (uint8_t)(responseSize & 0xFF);
}

/**
 * @brief Sends a Modbus response frame for the DEBUG_GET_LIST function code.
 *
 * This function constructs a Modbus response frame for the DEBUG_GET_LIST function code.
 * The response frame includes the trace data for variables specified in the provided index list.
 *
 * Modbus Response Frame (DEBUG_GET_LIST):
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 * | MB  | Resp. | Last  | Last  | Tick  | Tick  | Tick  | Tick  | Resp. | Resp.| Data  |
 * | FC  | Code  | Index | Index |       |       |       |       | Size  | Size | Bytes |
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 * |0x44 | Code  | High  | Low   | High  | Mid   | Mid   | Low   | High  | Low  | Data  |
 * |     |       | Byte  | Byte  | Byte  | Byte  | Byte  | Byte  | Byte  | Byte | Bytes |
 * +-----+-------+-------+-------+-------+-------+-------+-------+-------+------+-------+
 *
 * @param numIndexes The number of indexes requested.
 * @param indexArray Pointer to the array containing variable indexes.
 *
 * @return void
 */
// Phase 4 PDU: [FC, count_hi, count_lo, (arr:u8, elem_hi, elem_lo)×count]
// Response: [FC, STATUS, last_idx_hi, last_idx_lo,
//            tick_hi, tick_mh, tick_ml, tick_lo,
//            size_hi, size_lo, data...]
// last_idx is the index *into the request list* that was last successfully
// included — the editor uses it to retry from the next item on overflow.
void debugGetTraceList(uint16_t numIndexes, uint8_t *indexArray)
{
    uint16_t response_idx = 11;
    uint16_t responseSize = 0;
    uint16_t lastReqIdx = 0;

    #ifdef MB_SERIAL_ACTIVE
        #define VARIDX_SIZE 20
    #else
        #define VARIDX_SIZE 60
    #endif

    if (numIndexes > VARIDX_SIZE)
    {
        mb_frame_len = 3;
        mb_frame[1] = MB_FC_DEBUG_GET_LIST;
        mb_frame[2] = MB_DEBUG_ERROR_OUT_OF_MEMORY;
        return;
    }

    // The request indexArray (at mb_frame[4..]) and the response buffer
    // (mb_frame[11..]) overlap. Once handle_read writes the first response
    // byte, later index entries inside mb_frame are clobbered. Snapshot the
    // request first.
    uint8_t localIndex[VARIDX_SIZE * 3];
    for (uint16_t i = 0; i < numIndexes * 3; i++) {
        localIndex[i] = indexArray[i];
    }

    // Each address pair is 3 bytes: [arr:u8, elem_hi, elem_lo]
    for (uint16_t i = 0; i < numIndexes; i++)
    {
        uint8_t  arr  = localIndex[i * 3];
        uint16_t elem = (uint16_t)localIndex[i * 3 + 1] << 8 |
                         (uint16_t)localIndex[i * 3 + 2];

        uint16_t varSize = openplc_debug_size(arr, elem);
        if (varSize == 0)
        {
            // Out-of-bounds or string stub — skip gracefully.
            lastReqIdx = i;
            continue;
        }
        if ((response_idx + varSize) > MAX_MB_FRAME) break;

        uint16_t n = openplc_debug_read(arr, elem, &mb_frame[response_idx]);
        if (n == 0)
        {
            lastReqIdx = i;
            continue;
        }
        response_idx += n;
        responseSize += n;
        lastReqIdx = i;
    }

    mb_frame_len = response_idx;
    mb_frame[1] = MB_FC_DEBUG_GET_LIST;
    mb_frame[2] = MB_DEBUG_SUCCESS;
    mb_frame[3] = (uint8_t)(lastReqIdx >> 8);
    mb_frame[4] = (uint8_t)(lastReqIdx & 0xFF);
    mb_frame[5] = (uint8_t)((scan_counter >> 24) & 0xFF);
    mb_frame[6] = (uint8_t)((scan_counter >> 16) & 0xFF);
    mb_frame[7] = (uint8_t)((scan_counter >> 8)  & 0xFF);
    mb_frame[8] = (uint8_t)(scan_counter & 0xFF);
    mb_frame[9]  = (uint8_t)(responseSize >> 8);
    mb_frame[10] = (uint8_t)(responseSize & 0xFF);
}

// PDU request:  [FC, endian_check_hi, endian_check_lo]
// PDU response: [FC, STATUS, md5_ascii..., endian_marker_hi, endian_marker_lo]
//
// The target always writes variable data in native byte order — STruC++ does
// no server-side byte-order adaptation, force/read is pure memcpy.  To let
// the editor detect what "native" means here, the MD5 response trailer
// writes the literal value 0xDEAD via a native `uint16_t*` store.  The
// bytes that land in the response are therefore in the target's native
// byte order:
//
//     LE target  →  trailer bytes = [0xAD, 0xDE]
//     BE target  →  trailer bytes = [0xDE, 0xAD]
//
// The editor inspects those two bytes after MD5 verification and decides
// whether subsequent force/read traffic needs byte-swapping at its end.
//
// The probe bytes the editor sends are intentionally ignored — the trailer
// is a runtime-driven sentinel, not an echo.  The argument stays in the
// signature for ABI compatibility with the dispatcher.
void debugGetMd5(void * /*endianness*/)
{
    mb_frame[1] = MB_FC_DEBUG_GET_MD5;
    mb_frame[2] = MB_DEBUG_SUCCESS;

    const char md5[] = PROGRAM_MD5;
    int md5_len = 0;
    for (md5_len = 0; md5[md5_len] != '\0'; md5_len++)
    {
        mb_frame[md5_len + 3] = md5[md5_len];
    }

    // Native-order store of the endianness sentinel.  Written byte-wise
    // (not via `*reinterpret_cast<uint16_t*>`) because `md5_len + 3` is an
    // odd offset for a 32-char MD5, and a typed 16-bit store there is an
    // unaligned access that HardFaults on Cortex-M0+ (SAMD21: MKR Zero /
    // P1AM-100) — hanging the device on the first debugger request. Copying
    // the two bytes of a native-order uint16_t preserves the target's byte
    // ordering (the signal the editor uses to choose its swap behaviour)
    // while keeping every access byte-aligned.
    const uint16_t endian_sentinel = 0xDEAD;
    const uint8_t *sentinel_bytes = reinterpret_cast<const uint8_t *>(&endian_sentinel);
    mb_frame[md5_len + 3] = sentinel_bytes[0];
    mb_frame[md5_len + 4] = sentinel_bytes[1];
    mb_frame_len = md5_len + 5;
}

// PDU request:  [FC]
// PDU response: [FC, STATUS, running:u8, tick:u32 BE, uptime_ms:u32 BE]
//
// Lightweight liveness/diagnostic probe that does not require a full debug
// session. `running` is always 1 on baremetal (the PLC scan is unconditional);
// `tick` is the scan counter (same value the read FCs report), so a client can
// tell whether the PLC is actually cycling by watching it advance. `uptime_ms`
// is millis() since boot.
void debugGetStatus()
{
    uint32_t uptime = (uint32_t)millis();

    mb_frame[1] = MB_FC_DEBUG_GET_STATUS;
    mb_frame[2] = MB_DEBUG_SUCCESS;
    // The real run/stop state, not a constant: the baremetal runtime has a
    // state machine now (see arduino_runtime_glue.h). This byte being the
    // state is why there is no separate query function code -- the editor's
    // status poll already carries it.
    mb_frame[3] = runtime_get_plc_state();
    mb_frame[4] = (uint8_t)((scan_counter >> 24) & 0xFF);
    mb_frame[5] = (uint8_t)((scan_counter >> 16) & 0xFF);
    mb_frame[6] = (uint8_t)((scan_counter >> 8)  & 0xFF);
    mb_frame[7] = (uint8_t)(scan_counter & 0xFF);
    mb_frame[8]  = (uint8_t)((uptime >> 24) & 0xFF);
    mb_frame[9]  = (uint8_t)((uptime >> 16) & 0xFF);
    mb_frame[10] = (uint8_t)((uptime >> 8)  & 0xFF);
    mb_frame[11] = (uint8_t)(uptime & 0xFF);
    // Mode-switch position, appended so the editor can gate a start locally.
    // Boards with no physical switch report RUN, so a caller needs no "absent"
    // case; an older editor that stops reading at byte 11 simply ignores it.
    mb_frame[12] = runtime_get_switch_position();
    mb_frame_len = 13;
}

// PDU request:  [FC][state:u8]        (0 = STOP, 1 = RUN)
// PDU response: [FC][status][plc_state:u8][switch_position:u8]
//
// Command only -- reading the state is debugGetStatus() (FC 0x46) above, which
// already reports it. A RUN request while the mode switch reads STOP is
// REFUSED, not queued, so the editor tells the user to flip the switch instead
// of leaving a start pending. Stop requests are always honoured.
//
// The reported state is read back after the request is applied, but the runtime
// derives it inside runtime_plc_cycle() -- so on a change the value here is the
// state as of the last cycle and the caller sees the new one on its next status
// poll (at most one scan period later).
void plcSetState(uint8_t desired)
{
    uint8_t status = MB_DEBUG_SUCCESS;

    const uint8_t target = (desired == 0x01) ? PLC_STATE_RUNNING : PLC_STATE_STOPPED;
    if (runtime_request_plc_state(target) == PLC_CTRL_REFUSED_SWITCH_STOP)
        status = MB_PLC_CTRL_REFUSED_SWITCH;

    mb_frame[1] = MB_FC_PLC_SET_STATE;
    mb_frame[2] = status;
    mb_frame[3] = runtime_get_plc_state();
    mb_frame[4] = runtime_get_switch_position();
    mb_frame_len = 5;
}

// PDU request:  [FC]
// PDU response: [FC, STATUS, version_ascii...]  (no NUL terminator)
//
// Reports OPENPLC_RUNTIME_VERSION (defined in openplc_version.h). The editor
// reads the ASCII bytes up to the end of the frame.
void debugGetVersion()
{
    mb_frame[1] = MB_FC_DEBUG_GET_VERSION;
    mb_frame[2] = MB_DEBUG_SUCCESS;

    const char ver[] = OPENPLC_RUNTIME_VERSION;
    uint16_t i = 0;
    for (i = 0; ver[i] != '\0'; i++)
    {
        if ((uint16_t)(3 + i) >= MAX_MB_FRAME) break; // never overrun the frame
        mb_frame[3 + i] = (uint8_t)ver[i];
    }
    mb_frame_len = 3 + i;
}

// PDU request:  [FC]
// PDU response: [FC, STATUS, id_len:u8, id_bytes...]
//
// Returns the unique hardware ID via ArduinoUniqueID. id_len is UniqueIDsize
// (architecture-dependent: AVR 9-10, ESP8266 4, ESP32 6, SAM/SAMD 16, STM32
// 12, Teensy 8). On a core without support, id_len = 0 and no bytes follow.
void debugGetBoardId()
{
    mb_frame[1] = MB_FC_DEBUG_GET_BOARD_ID;
    mb_frame[2] = MB_DEBUG_SUCCESS;

#ifdef OPENPLC_HAS_UNIQUE_ID
    uint8_t idLen = (uint8_t)UniqueIDsize;
    // Clamp so [FC][STATUS][id_len][id_bytes...] always fits the frame.
    if ((uint16_t)(4 + idLen) > MAX_MB_FRAME) idLen = (uint8_t)(MAX_MB_FRAME - 4);
    mb_frame[3] = idLen;
    for (uint8_t i = 0; i < idLen; i++)
        mb_frame[4 + i] = UniqueID[i];
    mb_frame_len = 4 + idLen;
#else
    mb_frame[3] = 0; // no unique-id support on this core
    mb_frame_len = 4;
#endif
}

// ---------------------------------------------------------------------------
// On-device license storage (FC 0x49 write / 0x4A read)
//
// These two only MOVE BYTES. They do not verify a signature and do not decide
// anything about execution: that is the closed license-core's job, via
// license_gate.h. Keeping them dumb is what lets the open firmware carry them.
// ---------------------------------------------------------------------------

// PDU request:  [FC][len:u16 BE][blob...]   (dispatcher passes `len` already unpacked)
// PDU response: [FC][STATUS]
//
// NOTE on endianness: `len` on the wire is BIG-ENDIAN (matches every other debug
// FC, e.g. GET_LIST/SET). The blob CONTENT it carries is little-endian — the two
// are independent. `blob` points at mb_frame[4], and the response is only written
// after license_store_write has consumed it, so there is no overlap hazard.
void debugWriteLicense(uint16_t len, const uint8_t *blob)
{
    // The license blob is a FIXED 98 bytes; anything else is not one, so refuse
    // before the store ever sees it. Two separate problems close here.
    //
    // 1. CONTRACT. The two targets disagreed about this exact field: the Linux
    //    runtime answers LIC_CORRUPT for len != 98, while bare metal used to pass
    //    `len` straight through — so [0x49][len=0x0004][4 bytes] came back
    //    SUCCESS. One command, two contracts, and the editor believing whichever
    //    target it happened to be talking to.
    //
    // 2. OVERREAD. `len` is read from mb_frame[2..3] and can be up to 0xFFFF,
    //    while `blob` points into `mb_frame`, a static buffer of MAX_MB_FRAME
    //    (128 on 328P, 256 elsewhere). Over RTU this was already unreachable:
    //    mb_pdu_request_len() computes 6 + len, modbus_serial.cpp drops any frame
    //    whose expected length exceeds MAX_MB_FRAME, and it waits for the bytes to
    //    actually arrive. Over TCP nothing checked it: modbus_tcp.cpp bounds only
    //    the MBAP length (mb_frame_len) and never cross-checks it against this
    //    field, so a 6-byte packet declaring len = 0xFFFF would make
    //    license_store_write read ~64 KB past the frame. Testing `len` here is the
    //    one check that covers both transports at once.
    if ((size_t)len != (size_t)LIC_BLOB_SIZE)
    {
        mb_frame[1] = MB_FC_DEBUG_WRITE_LICENSE;
        mb_frame[2] = lic_status_to_mb(LIC_STORE_CORRUPT);
        mb_frame_len = 3;
        return;
    }

    lic_store_status_t st = license_store_write(blob, (size_t)len);
    mb_frame[1] = MB_FC_DEBUG_WRITE_LICENSE;
    mb_frame[2] = lic_status_to_mb(st);
    mb_frame_len = 3;
}

// PDU request:  [FC]
// PDU response (OK):                  [FC][STATUS][len:u16 BE][blob...]
// PDU response (EMPTY/CORRUPT/error): [FC][STATUS]   (no len, no blob)
//
// Absolute mb_frame indices (index 0 is the slave id, the PDU starts at 1,
// exactly like debugGetBoardId): FC@1, STATUS@2, len@3..4 (BIG-ENDIAN), blob@5.
//
// The store reads straight into &mb_frame[5]: the frame IS the static buffer, so
// there is no malloc on AVR. READ carries no request payload, so writing at [5]
// cannot clobber an input. `out_len` is unknown until after the read, and the len
// field lives at [3..4] — BEFORE the blob — so filling it afterwards never
// overlaps the blob bytes. A 98-byte blob fits MAX_MB_FRAME comfortably.
void debugReadLicense(void)
{
    size_t out_len = 0;
    lic_store_status_t st =
        license_store_read(&mb_frame[5], MAX_MB_FRAME - 5, &out_len);

    mb_frame[1] = MB_FC_DEBUG_READ_LICENSE;
    mb_frame[2] = lic_status_to_mb(st);
    if (st == LIC_STORE_OK)
    {
        // len BIG-ENDIAN at [3..4] (blob content stays little-endian).
        mb_frame[3] = (uint8_t)((out_len >> 8) & 0xFF);
        mb_frame[4] = (uint8_t)(out_len & 0xFF);
        mb_frame_len = 5 + out_len;
    }
    else
    {
        mb_frame_len = 3;   // [FC][STATUS] only
    }
}
