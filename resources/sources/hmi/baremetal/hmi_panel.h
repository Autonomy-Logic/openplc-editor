/**
 * @file hmi_panel.h
 * @brief Panel driver contract of a baremetal HMI. A board's HAL defines these functions for its display; the HMI host
 *        supplies weak no-op defaults, so firmware for a board without a driver still links and runs its PLC. A panel
 *        whose touch needs calibrating (capability touchCalibration, HMI_PANEL_TOUCH_CAL) defines the raw touch read
 *        and the store instead of hmi_panel_read_touch. The host calls them from the firmware's loop only, never from
 *        an interrupt.
 */
#ifndef HMI_PANEL_H
#define HMI_PANEL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Brings the panel up and reports its size in pixels; false when the board drives no panel. */
bool hmi_panel_init(int *width, int *height);

/**
 * Shows `rows` pixel rows starting at row y0. rgba holds `width` pixels per row as bytes R, G, B, A (A is 255); the
 * driver converts them to its color format and may do so in place, overwriting the buffer. The host rewrites the
 * buffer before its next use.
 */
void hmi_panel_push_band(int y0, int rows, uint8_t *rgba, int width);

/** Reads the touch input: true while pressed, with the point in panel pixels; false when released or without touch. */
bool hmi_panel_read_touch(int *x, int *y);

/**
 * Reads the touch input uncalibrated: true while pressed, with the readings in the panel's own units and orientation
 * (ADC counts of a resistive panel); false when released. The host maps them with the panel's calibration.
 */
bool hmi_panel_read_touch_raw(int32_t *x, int32_t *y);

/** Bytes the host keeps in the panel's store: the touch calibration and the build it was made under. */
#define HMI_PANEL_STORE_BYTES 96

/** Reads the record last written to the panel's non-volatile store; false when there is none. */
bool hmi_panel_store_read(uint8_t *buf, size_t len);

/** Writes the record to the panel's non-volatile store, replacing the last one; false when it could not. */
bool hmi_panel_store_write(const uint8_t *buf, size_t len);

#ifdef __cplusplus
}
#endif

#endif
