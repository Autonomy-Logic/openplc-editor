/**
 * @file hmi_internal.h
 * @brief Definitions shared by the HMI core's own files; not part of the public API.
 */
#ifndef HMI_INTERNAL_H
#define HMI_INTERNAL_H

#include <assert.h>
#include <stddef.h>
#include <stdint.h>

#include "hmi_core.h"

/* Internal invariants; checked in test and fuzz builds, compiled out with NDEBUG. */
#define HMI_ASSERT(cond) assert(cond)

/* Optional per-build sizes (display list capacity, bounds table), generated with the HMI unit. */
#if defined(__has_include)
#if __has_include("hmi_config.h")
#include "hmi_config.h"
#endif
#endif

#ifndef HMI_DL_CAPACITY
#define HMI_DL_CAPACITY (64 * 1024)
#endif
#ifndef HMI_BOUNDS_MAX
#define HMI_BOUNDS_MAX 512
#endif

/* Fixed payload sizes in bytes (opcode excluded), shared by the recorder and the rasterizer. */
#define HMI_PAYLOAD_CLEAR 4u
#define HMI_PAYLOAD_RECT 24u
#define HMI_PAYLOAD_RECT_STROKE 28u
#define HMI_PAYLOAD_LINE 24u
#define HMI_PAYLOAD_CIRCLE 16u
#define HMI_PAYLOAD_ARC 28u
#define HMI_PAYLOAD_TEXT_HEAD 20u /* followed by len bytes */
#define HMI_PAYLOAD_CLIP 16u
#define HMI_PAYLOAD_POLY_HEAD 6u /* followed by n * 8 bytes */

static inline uint32_t hmi_rd_u32(const uint8_t *p) {
    return (uint32_t)p[0] | ((uint32_t)p[1] << 8) | ((uint32_t)p[2] << 16) | ((uint32_t)p[3] << 24);
}
static inline int32_t hmi_rd_i32(const uint8_t *p) { return (int32_t)hmi_rd_u32(p); }
static inline uint16_t hmi_rd_u16(const uint8_t *p) { return (uint16_t)(p[0] | (p[1] << 8)); }
static inline void hmi_wr_u32(uint8_t *p, uint32_t v) {
    p[0] = (uint8_t)v;
    p[1] = (uint8_t)(v >> 8);
    p[2] = (uint8_t)(v >> 16);
    p[3] = (uint8_t)(v >> 24);
}

/**
 * Font data by face (::hmi_font), defined by the font table generated with the HMI unit. A NULL entry is a face the
 * build left out.
 */
extern const unsigned char *const hmi_font_table[HMI_FONTS];

/** Text advance in font units, before scaling; also returns the face's units per em. 0 when no face is built in. */
int64_t hmi_text_units(int font, const char *s, int len, int32_t *units_per_em);

/** Decodes one UTF-8 code point at s[*i] and advances *i; an invalid byte decodes as itself (Latin-1). */
int hmi_utf8_next(const unsigned char *s, int len, int *i);

/** Unit circle in 32 steps, Q14 (cos, sin), defined in hmi_math.c. */
extern const int16_t hmi_circle32[32][2];

/** Resolves a color (fixed or theme token, with transparency) to ARGB through theme `theme`. */
uint32_t hmi_color_resolve(uint32_t color, int32_t theme);

/** Length of the longest prefix of s within max bytes that does not split a UTF-8 sequence. */
int hmi_utf8_clip(const char *s, int len, int max);

/* ---- rasterizer internals ---- */

/** floor(v / 256) and ceil(v / 256) for any sign, without relying on the shift of negative values. */
static inline int32_t hmi_floor8(int32_t v) { return v >= 0 ? v >> 8 : -((-(v + 1)) >> 8) - 1; }
static inline int32_t hmi_ceil8(int32_t v) { return -hmi_floor8(-v); }

typedef struct {
    int x0, y0, x1, y1; /* device pixels, end exclusive */
} hmi_irect_t;

typedef struct {
    uint8_t *rgba; /* first byte of row band.y0 */
    int stride;    /* pixels */
    int32_t scale_q8, off_x, off_y;
    hmi_irect_t band; /* rows being rendered, full width */
    hmi_irect_t clip; /* current clip, inside band */
    hmi_clock_fn clock;
    uint32_t deadline;
    int aborted;
} hmi_raster_ctx_t;

/** True once the deadline has passed (sticky). */
int hmi_raster_expired(hmi_raster_ctx_t *c);
/** Blends argb at pixel (x, y) with an extra 8-bit coverage; (x, y) must be inside c->clip. */
void hmi_raster_blend_a8(const hmi_raster_ctx_t *c, int x, int y, uint32_t argb, uint32_t a8);
/** Draws a TEXT command; payload points after the opcode and holds a complete command. */
void hmi_raster_text(hmi_raster_ctx_t *c, const uint8_t *payload);

#endif
