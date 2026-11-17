/**
 * @file hmi_panel.h
 * @brief Panel driver contract of a baremetal HMI. A board's HAL defines these three functions for its display; the HMI
 *        host supplies weak no-op defaults, so firmware for a board without a driver still links and runs its PLC.
 *        The host calls them from the firmware's loop only, never from an interrupt.
 */
#ifndef HMI_PANEL_H
#define HMI_PANEL_H

#include <stdbool.h>
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

#ifdef __cplusplus
}
#endif

#endif
