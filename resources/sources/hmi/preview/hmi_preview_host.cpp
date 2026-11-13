/**
 * @file hmi_preview_host.cpp
 * @brief The editor's preview host: runs one viewer of a generated HMI unit inside a WebAssembly module and
 *        rasterizes its frames with the core.
 *
 * The page drives it through the exported functions below. Tags keep their declared initial values: the preview has
 * no PLC, so a write by a control stays in the preview's mirror. Frames are rasterized in bands; a band whose hash did
 * not change keeps its pixels, and hmi_pv_render reports the rows that changed so the page copies only those.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "hmi_core.h"
#include "hmi_preview.h"
#include "hmi_unit.h"
#include "iec_fault.hpp"

#define HMI_PV_EXPORT(name) extern "C" __attribute__((export_name(name)))

/** Device rows per raster band. */
#define HMI_PV_BAND_ROWS 32
/** Longest text hmi_pv_set_str takes, without its NUL. */
#define HMI_PV_TEXT_MAX 255

namespace {

struct Surface {
    uint8_t *rgba;
    uint32_t *hashes;
    int width;
    int height;
    int bands;
    int32_t scale_q8;
    int32_t offset_x;
    int32_t offset_y;
    bool valid;
};

hmi_session_t *g_session;
void *g_unit;
const uint8_t *g_dl;
size_t g_dl_len;
Surface g_surface;
int g_dirty_y0;
int g_dirty_rows;
char g_text[HMI_PV_TEXT_MAX + 1];

void release_surface() {
    free(g_surface.rgba);
    free(g_surface.hashes);
    g_surface = Surface{};
}

/** Sizes the surface for a w x h render; returns false when memory is short. Any change invalidates every band. */
bool prepare_surface(int w, int h, int32_t scale_q8, int32_t offset_x, int32_t offset_y) {
    if (g_surface.rgba && g_surface.width == w && g_surface.height == h && g_surface.scale_q8 == scale_q8 &&
        g_surface.offset_x == offset_x && g_surface.offset_y == offset_y)
        return true;
    release_surface();
    const int bands = (h + HMI_PV_BAND_ROWS - 1) / HMI_PV_BAND_ROWS;
    g_surface.rgba = static_cast<uint8_t *>(calloc(static_cast<size_t>(w) * static_cast<size_t>(h), 4));
    g_surface.hashes = static_cast<uint32_t *>(calloc(static_cast<size_t>(bands) * 2, sizeof(uint32_t)));
    if (!g_surface.rgba || !g_surface.hashes) {
        release_surface();
        return false;
    }
    g_surface.width = w;
    g_surface.height = h;
    g_surface.bands = bands;
    g_surface.scale_q8 = scale_q8;
    g_surface.offset_x = offset_x;
    g_surface.offset_y = offset_y;
    g_surface.valid = false;
    return true;
}

}  // namespace

namespace strucpp {
/** A fault in screen code ends the module; the page reports it and keeps the last good frame. */
[[noreturn]] void iec_runtime_fault(IecFault, const char *) noexcept { __builtin_trap(); }
}  // namespace strucpp

/** Starts the viewer on a w x h lu screen as admin; returns 0, or -1 when memory is short. */
HMI_PV_EXPORT("hmi_pv_init") int32_t hmi_pv_init(int32_t width_lu, int32_t height_lu) {
    g_session = hmi_session_create();
    g_unit = g_session ? hmi_unit_create() : nullptr;
    if (!g_unit) return -1;
    hmi_session_use(g_session);
    hmi_core_init(width_lu, height_lu);
    hmi_unit_set_role(g_unit, HMI_ROLE_ADMIN);
    return 0;
}

/** Changes the logical screen size, as a different device preset. */
HMI_PV_EXPORT("hmi_pv_resize") void hmi_pv_resize(int32_t width_lu, int32_t height_lu) {
    hmi_session_use(g_session);
    hmi_set_screen_size(width_lu, height_lu);
}

/** Design mode records connection ports as bounds, for the designer's pipe handles. */
HMI_PV_EXPORT("hmi_pv_design") void hmi_pv_design(int32_t on) {
    hmi_session_use(g_session);
    hmi_set_design_mode(on != 0);
}

/** Shows screen `page` (its page number) from the next frame, as a fresh start of that screen. */
HMI_PV_EXPORT("hmi_pv_show") void hmi_pv_show(int32_t page) {
    hmi_session_use(g_session);
    hmi_page_reset(page);
}

HMI_PV_EXPORT("hmi_pv_page") int32_t hmi_pv_page(void) {
    hmi_session_use(g_session);
    return hmi_page();
}

/** Runs one frame at time_ms; returns the display list length. */
HMI_PV_EXPORT("hmi_pv_frame") uint32_t hmi_pv_frame(uint32_t time_ms) {
    hmi_session_use(g_session);
    hmi_set_time_ms(time_ms);
    hmi_frame_begin();
    hmi_unit_frame(g_unit);
    g_dl = hmi_frame_end(&g_dl_len);
    return static_cast<uint32_t>(g_dl_len);
}

/** HMI_STATUS_* flags of the last frame. */
HMI_PV_EXPORT("hmi_pv_status") uint32_t hmi_pv_status(void) {
    hmi_session_use(g_session);
    return hmi_frame_status();
}

/**
 * Rasterizes the last frame into a w x h RGBA surface and returns its address, or 0 when memory is short or the
 * display list is bad. Only bands whose hash changed are drawn; hmi_pv_dirty_y0 and hmi_pv_dirty_rows give the span.
 */
HMI_PV_EXPORT("hmi_pv_render")
uint8_t *hmi_pv_render(int32_t w, int32_t h, int32_t scale_q8, int32_t offset_x, int32_t offset_y) {
    g_dirty_y0 = 0;
    g_dirty_rows = 0;
    if (w <= 0 || h <= 0 || !g_dl || !prepare_surface(w, h, scale_q8, offset_x, offset_y)) return nullptr;
    uint32_t *current = g_surface.hashes;
    uint32_t *previous = g_surface.hashes + g_surface.bands;
    if (hmi_raster_band_hashes(g_dl, g_dl_len, w, h, HMI_PV_BAND_ROWS, scale_q8, offset_x, offset_y, current,
                               g_surface.bands) != HMI_RASTER_OK)
        return nullptr;
    int first = -1, last = -1;
    for (int b = 0; b < g_surface.bands; b++) {
        if (g_surface.valid && current[b] == previous[b]) continue;
        const int y0 = b * HMI_PV_BAND_ROWS;
        const int rows = h - y0 < HMI_PV_BAND_ROWS ? h - y0 : HMI_PV_BAND_ROWS;
        uint8_t *row = g_surface.rgba + static_cast<size_t>(y0) * static_cast<size_t>(w) * 4;
        if (hmi_raster_render(g_dl, g_dl_len, row, w, h, w, y0, rows, scale_q8, offset_x, offset_y) != HMI_RASTER_OK) {
            g_surface.valid = false;
            return nullptr;
        }
        if (first < 0) first = b;
        last = b;
    }
    memcpy(previous, current, static_cast<size_t>(g_surface.bands) * sizeof(uint32_t));
    g_surface.valid = true;
    if (first >= 0) {
        g_dirty_y0 = first * HMI_PV_BAND_ROWS;
        const int end = (last + 1) * HMI_PV_BAND_ROWS;
        g_dirty_rows = (end < h ? end : h) - g_dirty_y0;
    }
    return g_surface.rgba;
}

HMI_PV_EXPORT("hmi_pv_dirty_y0") int32_t hmi_pv_dirty_y0(void) { return g_dirty_y0; }
HMI_PV_EXPORT("hmi_pv_dirty_rows") int32_t hmi_pv_dirty_rows(void) { return g_dirty_rows; }

/** Pointer input in Q4 lu (HMI_PTR_* kinds). */
HMI_PV_EXPORT("hmi_pv_pointer") void hmi_pv_pointer(int32_t kind, int32_t x_q4, int32_t y_q4) {
    hmi_session_use(g_session);
    hmi_input_pointer(kind, x_q4, y_q4);
}

HMI_PV_EXPORT("hmi_pv_key") void hmi_pv_key(uint32_t code) {
    hmi_session_use(g_session);
    hmi_input_key(code);
}

/** Element bounds of the last frame: hmi_pv_bounds_count records of (id, x, y, w, h), positions in Q4 lu. */
HMI_PV_EXPORT("hmi_pv_bounds_count") int32_t hmi_pv_bounds_count(void) {
    hmi_session_use(g_session);
    return hmi_bounds_count();
}

HMI_PV_EXPORT("hmi_pv_bounds") const int32_t *hmi_pv_bounds(void) {
    hmi_session_use(g_session);
    return hmi_bounds_data();
}

/** Sets a numeric or BOOL live property; returns 0, or -1 when there is no such setter. */
HMI_PV_EXPORT("hmi_pv_set_num") int32_t hmi_pv_set_num(int32_t screen, int32_t setter, double value) {
    return hmi_unit_set_num(g_unit, screen, setter, value);
}

/** Buffer of HMI_PV_TEXT_MAX + 1 bytes the page writes a NUL-terminated text into before hmi_pv_set_str. */
HMI_PV_EXPORT("hmi_pv_text") char *hmi_pv_text(void) { return g_text; }

/** Sets a STRING live property from hmi_pv_text; returns 0, or -1 when there is no such setter. */
HMI_PV_EXPORT("hmi_pv_set_str") int32_t hmi_pv_set_str(int32_t screen, int32_t setter) {
    g_text[HMI_PV_TEXT_MAX] = 0;
    return hmi_unit_set_str(g_unit, screen, setter, g_text);
}
