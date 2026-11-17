/**
 * @file hmi_client.c
 * @brief The browser client's WebAssembly host: draws the display lists a runtime sends over /api/hmi with the same
 *        rasterizer and fonts the device's HMI built them for. Built with the core's rasterizer and the unit's font
 *        table into hmi_client.wasm, which hmi-client.js loads.
 */
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>

#include "hmi_core.h"

#define HMI_CLIENT_EXPORT(name) __attribute__((export_name(name)))

/** Largest surface side the client draws, in device pixels. */
#define HMI_CLIENT_SIDE_MAX 16384
/** Largest display list taken, in bytes (the runtime sends at most 64 KiB). */
#define HMI_CLIENT_DL_MAX (4u * 1024u * 1024u)

static uint8_t *g_dl;
static size_t g_dl_cap;
static uint8_t *g_rgba;
static size_t g_rgba_cap;

/** Grows *buf to at least n bytes; false when memory is short. */
static int reserve(uint8_t **buf, size_t *cap, size_t n)
{
    if (n <= *cap)
        return 1;
    uint8_t *next = realloc(*buf, n);
    if (!next)
        return 0;
    *buf = next;
    *cap = n;
    return 1;
}

/** Where the next display list of len bytes is written; NULL when it is too large or memory is short. */
HMI_CLIENT_EXPORT("hmi_client_dl") uint8_t *hmi_client_dl(uint32_t len)
{
    if (len == 0 || len > HMI_CLIENT_DL_MAX || !reserve(&g_dl, &g_dl_cap, len))
        return NULL;
    return g_dl;
}

/**
 * Draws the display list of len bytes written at hmi_client_dl into an RGBA8888 surface of width x height device
 * pixels at scale_q8 device pixels per logical unit (Q8). Returns the surface, or NULL for a bad list or size.
 */
HMI_CLIENT_EXPORT("hmi_client_render")
uint8_t *hmi_client_render(uint32_t len, int32_t width, int32_t height, int32_t scale_q8)
{
    if (!g_dl || len == 0 || len > g_dl_cap || width <= 0 || height <= 0 || width > HMI_CLIENT_SIDE_MAX ||
        height > HMI_CLIENT_SIDE_MAX || scale_q8 <= 0)
        return NULL;
    const size_t bytes = (size_t)width * (size_t)height * 4u;
    if (!reserve(&g_rgba, &g_rgba_cap, bytes))
        return NULL;
    const int rc = hmi_raster_render(g_dl, len, g_rgba, width, height, width, 0, height, scale_q8, 0, 0);
    return rc == HMI_RASTER_OK ? g_rgba : NULL;
}

/** Logical size of the display list written at hmi_client_dl: width in the low 16 bits, height in the high. */
HMI_CLIENT_EXPORT("hmi_client_dl_size") uint32_t hmi_client_dl_size(uint32_t len)
{
    if (!g_dl || len < HMI_DL_HEADER_SIZE || len > g_dl_cap)
        return 0;
    const uint8_t *p = g_dl;
    const uint32_t magic = (uint32_t)p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24;
    if (magic != HMI_DL_MAGIC)
        return 0;
    const int32_t w = (int32_t)((uint32_t)p[8] | (uint32_t)p[9] << 8 | (uint32_t)p[10] << 16 | (uint32_t)p[11] << 24);
    const int32_t h =
        (int32_t)((uint32_t)p[12] | (uint32_t)p[13] << 8 | (uint32_t)p[14] << 16 | (uint32_t)p[15] << 24);
    if (w <= 0 || h <= 0 || w > 0xFFFF || h > 0xFFFF)
        return 0;
    return (uint32_t)w | (uint32_t)h << 16;
}
