/**
 * @file hmi_preview_host.cpp
 * @brief The editor's preview host: runs a generated HMI unit in a WebAssembly module, keeping its own variables, and
 *        rasterizes its frames in bands, reporting the rows that changed.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "hmi_core.h"
extern "C" {
#include "hmi_internal.h"
}
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

/** Runs one frame at time_ms; returns the display list length. A frame that builds another screen ends live elements. */
HMI_PV_EXPORT("hmi_pv_frame") uint32_t hmi_pv_frame(uint32_t time_ms) {
    hmi_session_use(g_session);
    hmi_set_time_ms(time_ms);
    hmi_frame_begin();
    hmi_unit_frame(g_unit);
    g_dl = hmi_frame_end(&g_dl_len);
    hmi_unit_live_sync(g_unit);
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

namespace {

/** Extent of what the last frame drew: x0, y0, x1, y1 in Q4 lu; x1 <= x0 when it drew nothing. */
int32_t g_drawn[4];

/** Adds a box, cut to the clip, to the drawn extent. */
void add_drawn(int64_t x0, int64_t y0, int64_t x1, int64_t y1, const int64_t clip[4], bool clipped, bool *any) {
    if (clipped) {
        if (x0 < clip[0]) x0 = clip[0];
        if (y0 < clip[1]) y0 = clip[1];
        if (x1 > clip[2]) x1 = clip[2];
        if (y1 > clip[3]) y1 = clip[3];
    }
    if (x1 <= x0 || y1 <= y0) return;
    if (!*any || x0 < g_drawn[0]) g_drawn[0] = static_cast<int32_t>(x0);
    if (!*any || y0 < g_drawn[1]) g_drawn[1] = static_cast<int32_t>(y0);
    if (!*any || x1 > g_drawn[2]) g_drawn[2] = static_cast<int32_t>(x1);
    if (!*any || y1 > g_drawn[3]) g_drawn[3] = static_cast<int32_t>(y1);
    *any = true;
}

bool visible(uint32_t argb) { return (argb >> 24) != 0; }

/** Works out g_drawn from the last frame's commands: every visible mark but the screen's clear, within its clip. */
void measure_drawn() {
    g_drawn[0] = g_drawn[1] = g_drawn[2] = g_drawn[3] = 0;
    if (!g_dl || g_dl_len < HMI_DL_HEADER_SIZE) return;
    const uint8_t *p = g_dl + HMI_DL_HEADER_SIZE, *end = g_dl + g_dl_len;
    const uint32_t n = hmi_rd_u32(g_dl + 16);
    int64_t clip[4] = {0, 0, 0, 0};
    bool clipped = false, any = false;
    for (uint32_t k = 0; k < n && p < end; k++) {
        const uint8_t op = *p++;
        const size_t avail = static_cast<size_t>(end - p);
        switch (op) {
        case HMI_OP_CLEAR:
            p += HMI_PAYLOAD_CLEAR;
            break;
        case HMI_OP_RECT:
        case HMI_OP_RECT_STROKE: {
            const size_t sz = op == HMI_OP_RECT ? HMI_PAYLOAD_RECT : HMI_PAYLOAD_RECT_STROKE;
            if (avail < sz) return;
            const int64_t x = hmi_rd_i32(p), y = hmi_rd_i32(p + 4), w = hmi_rd_i32(p + 8), h = hmi_rd_i32(p + 12);
            const int64_t half = op == HMI_OP_RECT ? 0 : llabs(static_cast<int64_t>(hmi_rd_i32(p + 20))) / 2;
            if (visible(hmi_rd_u32(p + sz - 4))) add_drawn(x - half, y - half, x + w + half, y + h + half, clip, clipped, &any);
            p += sz;
            break;
        }
        case HMI_OP_LINE: {
            if (avail < HMI_PAYLOAD_LINE) return;
            const int64_t x1 = hmi_rd_i32(p), y1 = hmi_rd_i32(p + 4), x2 = hmi_rd_i32(p + 8), y2 = hmi_rd_i32(p + 12);
            const int64_t half = llabs(static_cast<int64_t>(hmi_rd_i32(p + 16))) / 2;
            if (visible(hmi_rd_u32(p + 20)))
                add_drawn((x1 < x2 ? x1 : x2) - half, (y1 < y2 ? y1 : y2) - half, (x1 > x2 ? x1 : x2) + half,
                          (y1 > y2 ? y1 : y2) + half, clip, clipped, &any);
            p += HMI_PAYLOAD_LINE;
            break;
        }
        case HMI_OP_CIRCLE:
        case HMI_OP_ARC: {
            const size_t sz = op == HMI_OP_CIRCLE ? HMI_PAYLOAD_CIRCLE : HMI_PAYLOAD_ARC;
            if (avail < sz) return;
            const int64_t cx = hmi_rd_i32(p), cy = hmi_rd_i32(p + 4);
            int64_t r = llabs(static_cast<int64_t>(hmi_rd_i32(p + 8)));
            if (op == HMI_OP_ARC) r += llabs(static_cast<int64_t>(hmi_rd_i32(p + 12))) / 2;
            if (visible(hmi_rd_u32(p + sz - 4))) add_drawn(cx - r, cy - r, cx + r, cy + r, clip, clipped, &any);
            p += sz;
            break;
        }
        case HMI_OP_TEXT: {
            if (avail < HMI_PAYLOAD_TEXT_HEAD) return;
            const uint16_t len = hmi_rd_u16(p + 18);
            if (avail < HMI_PAYLOAD_TEXT_HEAD + len) return;
            const int64_t x = hmi_rd_i32(p), y = hmi_rd_i32(p + 4), size = hmi_rd_i32(p + 8);
            const int64_t w = static_cast<int64_t>(hmi_text_width(reinterpret_cast<const char *>(p + 20), len,
                                                                  static_cast<int32_t>(size / 16), p[12])) * 16;
            const int64_t x0 = p[13] == HMI_ALIGN_CENTER ? x - w / 2 : p[13] == HMI_ALIGN_RIGHT ? x - w : x;
            if (visible(hmi_rd_u32(p + 14))) add_drawn(x0, y, x0 + w, y + size, clip, clipped, &any);
            p += HMI_PAYLOAD_TEXT_HEAD + len;
            break;
        }
        case HMI_OP_CLIP:
            if (avail < HMI_PAYLOAD_CLIP) return;
            clip[0] = hmi_rd_i32(p);
            clip[1] = hmi_rd_i32(p + 4);
            clip[2] = clip[0] + hmi_rd_i32(p + 8);
            clip[3] = clip[1] + hmi_rd_i32(p + 12);
            clipped = true;
            p += HMI_PAYLOAD_CLIP;
            break;
        case HMI_OP_UNCLIP:
            clipped = false;
            break;
        case HMI_OP_POLY: {
            if (avail < HMI_PAYLOAD_POLY_HEAD) return;
            const uint16_t np = hmi_rd_u16(p + 4);
            const size_t sz = HMI_PAYLOAD_POLY_HEAD + static_cast<size_t>(np) * 8u;
            if (avail < sz || np == 0) return;
            int64_t x0 = hmi_rd_i32(p + 6), y0 = hmi_rd_i32(p + 10), x1 = x0, y1 = y0;
            for (uint16_t i = 1; i < np; i++) {
                const int64_t x = hmi_rd_i32(p + 6 + static_cast<size_t>(i) * 8u);
                const int64_t y = hmi_rd_i32(p + 10 + static_cast<size_t>(i) * 8u);
                if (x < x0) x0 = x;
                if (y < y0) y0 = y;
                if (x > x1) x1 = x;
                if (y > y1) y1 = y;
            }
            if (visible(hmi_rd_u32(p))) add_drawn(x0, y0, x1, y1, clip, clipped, &any);
            p += sz;
            break;
        }
        default:
            return;
        }
    }
}

}  // namespace

/** Extent of what the last frame drew, as x0, y0, x1, y1 in Q4 lu (x1 <= x0: nothing), clips applied, clear left out. */
HMI_PV_EXPORT("hmi_pv_drawn") const int32_t *hmi_pv_drawn(void) {
    hmi_session_use(g_session);
    measure_drawn();
    return g_drawn;
}

/** Sets a numeric or BOOL live property; returns 0, or -1 when there is no such setter or its screen is not shown. */
HMI_PV_EXPORT("hmi_pv_set_num") int32_t hmi_pv_set_num(int32_t screen, int32_t setter, double value) {
    return hmi_unit_set_num(g_unit, screen, setter, value);
}

/** Buffer of HMI_PV_TEXT_MAX + 1 bytes the page writes a NUL-terminated text into before hmi_pv_set_str. */
HMI_PV_EXPORT("hmi_pv_text") char *hmi_pv_text(void) { return g_text; }

/** Sets a STRING live property from hmi_pv_text; returns 0, or -1 when there is no such setter or its screen is not shown. */
HMI_PV_EXPORT("hmi_pv_set_str") int32_t hmi_pv_set_str(int32_t screen, int32_t setter) {
    g_text[HMI_PV_TEXT_MAX] = 0;
    return hmi_unit_set_str(g_unit, screen, setter, g_text);
}

/**
 * Adds an element of factory type `type` to the shown screen (hmi_unit_live_add); returns its element id, or -1. Its
 * inputs are set with hmi_pv_live_set_num and _str before the next frame.
 */
HMI_PV_EXPORT("hmi_pv_live_add")
int32_t hmi_pv_live_add(int32_t type, int32_t parent, int32_t parent_kind, int32_t before, int32_t draw_before) {
    return hmi_unit_live_add(g_unit, type, parent, parent_kind, before, draw_before);
}

HMI_PV_EXPORT("hmi_pv_live_set_num") int32_t hmi_pv_live_set_num(int32_t element, int32_t setter, double value) {
    return hmi_unit_live_set_num(g_unit, element, setter, value);
}

/** Sets a STRING input of a live element from hmi_pv_text. */
HMI_PV_EXPORT("hmi_pv_live_set_str") int32_t hmi_pv_live_set_str(int32_t element, int32_t setter) {
    g_text[HMI_PV_TEXT_MAX] = 0;
    return hmi_unit_live_set_str(g_unit, element, setter, g_text);
}

HMI_PV_EXPORT("hmi_pv_live_remove") int32_t hmi_pv_live_remove(int32_t element) {
    return hmi_unit_live_remove(g_unit, element);
}

/** Takes an element off its container and the drawing list (hmi_unit_live_detach); returns 0, or -1. */
HMI_PV_EXPORT("hmi_pv_live_detach")
int32_t hmi_pv_live_detach(int32_t element, int32_t parent, int32_t parent_kind) {
    return hmi_unit_live_detach(g_unit, element, parent, parent_kind);
}

/** Puts a detached element back (hmi_unit_live_attach); returns its id, or -1. */
HMI_PV_EXPORT("hmi_pv_live_attach")
int32_t hmi_pv_live_attach(int32_t element, int32_t parent, int32_t parent_kind, int32_t before, int32_t draw_before) {
    return hmi_unit_live_attach(g_unit, element, parent, parent_kind, before, draw_before);
}
