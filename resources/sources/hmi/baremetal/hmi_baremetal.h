/**
 * @file hmi_baremetal.h
 * @brief HMI host of the Baremetal firmware: runs the generated HMI unit on the board's panel (hmi_panel.h) in the
 *        scan cycle's slack only, so the HMI may drop frames but never delays a scan. Built with HMI_STATIC_MEMORY: no
 *        heap is used, and an HMI too big for the board fails when the firmware links.
 */
#ifndef HMI_BAREMETAL_H
#define HMI_BAREMETAL_H

#include <stdbool.h>
#include <stdint.h>

/** Stack of the task that runs loop() in HMI firmware, where the platform sizes it (ESP32: SET_LOOP_TASK_STACK_SIZE). */
#ifndef HMI_BM_LOOP_STACK_BYTES
#define HMI_BM_LOOP_STACK_BYTES 16384
#endif

#ifdef __cplusplus
extern "C" {
#endif

/** Monotonic microsecond clock; wrap-around is handled. */
typedef uint32_t (*hmi_bm_clock_fn)(void);

/**
 * Starts the HMI from setup(), before the first scan: brings the panel up, creates the unit and draws the first frame,
 * which also measures what later frames cost. Returns false, and the HMI stays off, without a panel or a clock, or when
 * the panel's size differs from the size the firmware was built for (hmi_config.h).
 */
bool hmi_bm_init(hmi_bm_clock_fn clock_us);

/**
 * Runs HMI work that fits in slack_us, the time left before the next scan is due, keeping a guard free: touch input,
 * a logic frame (screens and display list), or the rows of changed bands, each started only when its learned cost
 * fits. Does nothing while the HMI is off.
 */
void hmi_bm_task(uint32_t slack_us);

/** Whether the HMI runs (hmi_bm_init succeeded). */
bool hmi_bm_active(void);

/** Why the HMI is off after hmi_bm_init; HMI_BM_ON while it runs. */
typedef enum {
    HMI_BM_ON = 0,
    HMI_BM_OFF_NO_CLOCK = 1,
    HMI_BM_OFF_NO_PANEL = 2,
    HMI_BM_OFF_PANEL_SIZE = 3, /**< the panel's size differs from the size the firmware was built for */
    HMI_BM_OFF_BAND_BUFFER = 4, /**< the band buffer holds less than one panel row */
    HMI_BM_OFF_NO_UNIT = 5,
} hmi_bm_off_reason_t;

/** Counters of the HMI task, for tests on hardware (HMI_TEST_READOUT builds only). */
typedef struct {
    uint32_t frames_drawn;  /**< frames whose changed bands all reached the panel */
    uint32_t bands_pushed;  /**< pushes to the panel */
    uint32_t scan_overruns; /**< task calls that ran past the slack they were given */
    uint32_t last_logic_us; /**< duration of the last logic frame */
    uint32_t worst_band_us; /**< longest raster and push of one band */
    uint32_t off_reason;    /**< ::hmi_bm_off_reason_t */
    uint32_t touch_skips;   /**< touch reads postponed because they did not fit in the slack */
} hmi_bm_stats_t;

/**
 * HMI_TEST_READOUT builds only: holds the current display list for reading (no new logic frame starts until it is read
 * to the end or 2 s pass) and returns its length, or -1 without one.
 */
int32_t hmi_bm_dl_hold(void);
/** HMI_TEST_READOUT builds only: copies up to max bytes of the held display list from offset; -1 when none is held. */
int32_t hmi_bm_dl_read(uint32_t offset, uint8_t *out, int32_t max);
/** HMI_TEST_READOUT builds only: the task's counters. */
void hmi_bm_stats(hmi_bm_stats_t *out);

#ifdef __cplusplus
}
#endif

#endif
