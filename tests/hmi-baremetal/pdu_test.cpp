/**
 * @file pdu_test.cpp
 * The Modbus side of the test-only HMI readout (FC 0x4E and 0x4F) in a HMI_TEST_READOUT firmware: frame lengths,
 * routing to the editor's id, operand decoding and the responses, with the firmware's Modbus PDU and debug sources
 * built natively against the simulator's Arduino stub and a fake HMI host. Exits non-zero on a failed check.
 */
#include <stdio.h>
#include <string.h>

#include "arduino_runtime_glue.h"
#include "hmi_baremetal.h"
#include "license_gate.h"
#include "license_store.h"
#include "modbus_debug.h"
#include "modbus_pdu.h"
#include "openplc.h"

static int g_failures;

#define CHECK(cond, ...)                                                                                               \
    do {                                                                                                               \
        if (!(cond)) {                                                                                                 \
            printf("FAIL %s:%d: ", __FILE__, __LINE__);                                                                \
            printf(__VA_ARGS__);                                                                                       \
            printf("\n");                                                                                              \
            g_failures++;                                                                                              \
        }                                                                                                              \
    } while (0)

/** What the fake HMI host saw and returns. */
static int g_holds;
static uint32_t g_read_offset;
static int32_t g_read_max = -2;
static int32_t g_read_result;
static const int32_t kTotal = 0x00012345;

extern "C" int32_t hmi_bm_dl_hold(void) {
    g_holds++;
    return kTotal;
}

extern "C" int32_t hmi_bm_dl_read(uint32_t offset, uint8_t *out, int32_t max) {
    g_read_offset = offset;
    g_read_max = max;
    if (g_read_result < 0) return g_read_result;
    int32_t n = g_read_result < max ? g_read_result : max;
    for (int32_t i = 0; i < n; i++) out[i] = (uint8_t)(0xA0 + i);
    return n;
}

extern "C" void hmi_bm_stats(hmi_bm_stats_t *out) {
    out->frames_drawn = 1;
    out->bands_pushed = 2;
    out->scan_overruns = 3;
    out->last_logic_us = 4;
    out->worst_band_us = 5;
    out->off_reason = 6;
    out->touch_skips = 7;
}

uint32_t scan_counter;
extern "C" unsigned long millis(void) { return 0; }
extern "C" uint8_t openplc_debug_array_count(void) { return 0; }
extern "C" uint16_t openplc_debug_elem_count(uint8_t) { return 0; }
extern "C" uint16_t openplc_debug_size(uint8_t, uint16_t) { return 0; }
extern "C" uint16_t openplc_debug_read(uint8_t, uint16_t, uint8_t *) { return 0; }
extern "C" uint8_t openplc_debug_set(uint8_t, uint16_t, uint8_t, const uint8_t *, uint16_t) { return 0; }
uint8_t runtime_get_plc_state(void) { return 0; }
uint8_t runtime_get_switch_position(void) { return 0; }
uint8_t runtime_request_plc_state(uint8_t) { return 0; }
uint8_t hardwareProgrammingLocked(void) { return 0; }
void hardwarePromptUnlock(void) {}
void hardwareRebootToBootloader(void) {}
size_t license_gate_device_id(uint8_t *, size_t) { return 0; }
lic_store_status_t license_store_read(uint8_t *, size_t, size_t *) { return (lic_store_status_t)0; }
lic_store_status_t license_store_write(const uint8_t *, size_t) { return (lic_store_status_t)0; }

static uint32_t be32(const uint8_t *p) {
    return (uint32_t)p[0] << 24 | (uint32_t)p[1] << 16 | (uint32_t)p[2] << 8 | (uint32_t)p[3];
}

/** Puts a request PDU behind slave id 1 into mb_frame and dispatches it. */
static void dispatch(const uint8_t *pdu, uint16_t n) {
    memset(mb_frame, 0, sizeof mb_frame);
    mb_frame[0] = 1;
    memcpy(mb_frame + 1, pdu, n);
    mb_frame_len = (uint16_t)(n + 1);
    process_mbpacket();
}

int main(void) {
    const uint8_t head_dl[2] = {1, MB_FC_HMI_GET_DL}, head_stats[2] = {1, MB_FC_HMI_GET_STATS};
    CHECK(mb_pdu_request_len(head_dl, 2) == 9, "0x4E frame length %d", (int)mb_pdu_request_len(head_dl, 2));
    CHECK(mb_pdu_request_len(head_stats, 2) == 4, "0x4F frame length %d", (int)mb_pdu_request_len(head_stats, 2));
    CHECK(mb_pdu_is_editor_fc(MB_FC_HMI_GET_DL) && mb_pdu_is_editor_fc(MB_FC_HMI_GET_STATS),
          "the readout codes are not routed to the editor's id");
    CHECK(!mb_pdu_is_editor_fc(MB_FC_HMI_GET_STATS + 1), "0x50 is routed to the editor's id");
    CHECK(mb_pdu_skips_crc(MB_FC_HMI_GET_DL) && mb_pdu_skips_crc(MB_FC_HMI_GET_STATS), "the readout codes check a CRC");

    g_read_result = 10;
    const uint8_t first[6] = {MB_FC_HMI_GET_DL, 0, 0, 0, 0, 200};
    dispatch(first, sizeof first);
    CHECK(g_holds == 1, "offset 0 did not hold the display list");
    CHECK(g_read_offset == 0, "offset 0 read from %u", (unsigned)g_read_offset);
    CHECK(g_read_max == 200, "a 200-byte chunk asked for %d", (int)g_read_max);
    CHECK(mb_frame[1] == MB_FC_HMI_GET_DL && mb_frame[2] == MB_DEBUG_SUCCESS, "0x4E answered %02X %02X", mb_frame[1],
          mb_frame[2]);
    CHECK(be32(mb_frame + 3) == (uint32_t)kTotal, "total %08X", (unsigned)be32(mb_frame + 3));
    CHECK(mb_frame[7] == 10 && mb_frame_len == 18, "chunk of %u bytes in a frame of %u", mb_frame[7], mb_frame_len);
    CHECK(mb_frame[8] == 0xA0 && mb_frame[17] == 0xA9, "chunk bytes not copied");

    const uint8_t next[6] = {MB_FC_HMI_GET_DL, 0x01, 0x02, 0x03, 0x04, 255};
    dispatch(next, sizeof next);
    CHECK(g_holds == 1, "a later chunk held the display list again");
    CHECK(g_read_offset == 0x01020304u, "offset decoded as %08X", (unsigned)g_read_offset);
    CHECK(g_read_max == (int32_t)MB_RESPONSE_CAPACITY - 8 || g_read_max == 255,
          "a chunk larger than the response asked for %d", (int)g_read_max);
    CHECK(g_read_max <= (int32_t)MB_RESPONSE_CAPACITY - 8, "a chunk of %d bytes overflows the response",
          (int)g_read_max);
    CHECK(be32(mb_frame + 3) == 0, "a later chunk reported a total");

    g_read_result = -1;
    dispatch(next, sizeof next);
    CHECK(mb_frame[2] == MB_DEBUG_ERROR_OUT_OF_BOUNDS && mb_frame_len == 3, "a read with nothing held answered %02X/%u",
          mb_frame[2], mb_frame_len);

    const uint8_t truncated[3] = {MB_FC_HMI_GET_DL, 0, 0};
    dispatch(truncated, sizeof truncated);
    CHECK(mb_frame[1] == (MB_FC_HMI_GET_DL | 0x80) && mb_frame[2] == MB_EX_ILLEGAL_VALUE,
          "a truncated 0x4E answered %02X %02X", mb_frame[1], mb_frame[2]);

    const uint8_t stats[1] = {MB_FC_HMI_GET_STATS};
    dispatch(stats, sizeof stats);
    CHECK(mb_frame[1] == MB_FC_HMI_GET_STATS && mb_frame[2] == MB_DEBUG_SUCCESS && mb_frame[3] == 8,
          "0x4F answered %02X %02X with %u words", mb_frame[1], mb_frame[2], mb_frame[3]);
    CHECK(mb_frame_len == 4 + 8 * 4, "0x4F frame of %u bytes", mb_frame_len);
    const uint32_t want[] = {1, 2, 3, 4, 5, 0xFFFFFFFFu, 6, 7};
    for (int i = 0; i < 8; i++)
        CHECK(be32(mb_frame + 4 + i * 4) == want[i], "0x4F word %d is %08X", i, (unsigned)be32(mb_frame + 4 + i * 4));

    if (g_failures > 0) {
        printf("%d check(s) failed\n", g_failures);
        return 1;
    }
    printf("pdu: ok\n");
    return 0;
}
