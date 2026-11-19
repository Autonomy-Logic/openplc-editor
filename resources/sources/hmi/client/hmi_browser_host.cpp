/**
 * @file hmi_browser_host.cpp
 * @brief The Runtime v4 browser client's WebAssembly host: runs the project's HMI unit for one viewer, with the PLC
 *        values the runtime sends, and rasterizes its frames in bands, reporting the rows that changed. Screen writes
 *        update the local value at once and are queued for the runtime, which applies or refuses them.
 *
 * Writes are tagged with the screen shown when screen code made them, so the client asks the runtime for a newly shown
 * screen right before that screen's first write. Values cross as the runtime's VALUES records (`u16 tag, u16 len, bytes`, little endian): a tag's IEC width, or the
 * text of a STRING without its NUL. A value received for a tag whose last write the runtime has not processed yet
 * (its write count is behind) is skipped, so a screen never shows a value older than its own write.
 */
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "hmi_core.h"
#include "hmi_unit.h"
#include "iec_fault.hpp"

#define HMI_BH_EXPORT(name) extern "C" __attribute__((export_name(name)))

/** Device rows per raster band. */
#define HMI_BH_BAND_ROWS 32
/** Largest message hmi_bh_in takes, in bytes. */
#define HMI_BH_IN_MAX (4u * 1024u * 1024u)
/** Bytes of a VALUES payload before its records: page, write count, record count. */
#define HMI_BH_VALUES_HEADER 8u

namespace {

struct Surface {
    uint8_t *rgba;
    uint32_t *hashes;
    int width;
    int height;
    int bands;
    int32_t scale_q8;
    bool valid;
};

struct Growable {
    uint8_t *data;
    size_t len;
    size_t cap;
};

hmi_session_t *g_session;
void *g_unit;
const uint8_t *g_dl;
size_t g_dl_len;
Surface g_surface;
int g_dirty_y0;
int g_dirty_rows;

/** Each tag's value in its buffer format (hmi_tag_size bytes), and whether one was received. */
uint8_t **g_values;
bool *g_known;
/** Count of the write that last changed each tag (0: none), and of all writes queued since the last reset. */
uint32_t *g_write_index;
uint32_t g_writes;
Growable g_in;
Growable g_out;

bool reserve(Growable *b, size_t need) {
    if (b->cap >= need) return true;
    size_t cap = b->cap ? b->cap : 256u;
    while (cap < need) cap *= 2u;
    auto *p = static_cast<uint8_t *>(realloc(b->data, cap));
    if (!p) return false;
    b->data = p;
    b->cap = cap;
    return true;
}

void put_u16(uint8_t *p, uint32_t v) {
    p[0] = static_cast<uint8_t>(v);
    p[1] = static_cast<uint8_t>(v >> 8);
}

uint32_t get_u16(const uint8_t *p) { return static_cast<uint32_t>(p[0]) | static_cast<uint32_t>(p[1]) << 8; }

uint32_t get_u32(const uint8_t *p) { return get_u16(p) | get_u16(p + 2) << 16; }

bool is_string(int tag) { return hmi_tags[tag].type == HMI_TAG_STRING; }

/** Bytes a tag's value takes on the wire: the buffer length of a number, the text length of a STRING. */
size_t wire_length(int tag, const uint8_t *buffer) {
    if (!is_string(tag)) return hmi_tag_size(tag);
    size_t n = 0;
    while (n < hmi_tags[tag].max_len && buffer[n] != 0) n++;
    return n;
}

/** Stores a received value in the tag's buffer; false when its length or content does not fit the tag. */
bool store_wire(int tag, const uint8_t *bytes, size_t len) {
    uint8_t *dest = g_values[tag];
    if (is_string(tag)) {
        if (len > hmi_tags[tag].max_len || memchr(bytes, 0, len) != nullptr) return false;
        memcpy(dest, bytes, len);
        dest[len] = 0;
    } else {
        if (len != hmi_tag_size(tag)) return false;
        memcpy(dest, bytes, len);
    }
    g_known[tag] = true;
    return true;
}

bool tag_read(void *, int tag, void *dest) {
    if (tag < 0 || tag >= hmi_tag_count || !g_known[tag]) return false;
    memcpy(dest, g_values[tag], hmi_tag_size(tag));
    return true;
}

/** Bytes of an out record before its value: page, tag, kind, bit, length. */
constexpr size_t kOutHeader = 8;
constexpr uint8_t kWriteWord = 0;

/** Queues one write record for the runtime: the page shown when it was made, the tag, its kind and its value. */
void queue_write(int tag, uint8_t kind, uint8_t bit, const uint8_t *value, size_t len) {
    if (!reserve(&g_out, g_out.len + kOutHeader + len)) return;
    uint8_t *p = g_out.data + g_out.len;
    hmi_session_use(g_session);
    const int32_t page = hmi_page_shown();
    put_u16(p, page < 0 ? 0xFFFFu : static_cast<uint32_t>(page));
    put_u16(p + 2, static_cast<uint32_t>(tag));
    p[4] = kind;
    p[5] = bit;
    put_u16(p + 6, static_cast<uint32_t>(len));
    if (len > 0) memcpy(p + kOutHeader, value, len);
    g_out.len += kOutHeader + len;
    g_write_index[tag] = ++g_writes;
}

/** A screen's write: kept as the tag's value and queued for the runtime as one record. */
void tag_write(void *, int tag, const void *src) {
    if (tag < 0 || tag >= hmi_tag_count) return;
    const size_t size = hmi_tag_size(tag);
    memcpy(g_values[tag], src, size);
    if (is_string(tag)) g_values[tag][size - 1] = 0;
    g_known[tag] = true;
    queue_write(tag, kWriteWord, 0, g_values[tag], wire_length(tag, g_values[tag]));
}

const hmi_tag_access_t g_access = {tag_read, tag_write, nullptr};

void release_surface() {
    free(g_surface.rgba);
    free(g_surface.hashes);
    g_surface = Surface{};
}

bool prepare_surface(int w, int h, int32_t scale_q8) {
    if (g_surface.rgba && g_surface.width == w && g_surface.height == h && g_surface.scale_q8 == scale_q8) return true;
    release_surface();
    const int bands = (h + HMI_BH_BAND_ROWS - 1) / HMI_BH_BAND_ROWS;
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
    g_surface.valid = false;
    return true;
}

}  // namespace

namespace strucpp {
/** A fault in screen code ends the module; the page reports it and starts the screens again. */
[[noreturn]] void iec_runtime_fault(IecFault, const char *) noexcept { __builtin_trap(); }
}  // namespace strucpp

/** Starts the viewer on a w x h lu screen with its role (::hmi_role); returns 0, or -1 when memory is short. */
HMI_BH_EXPORT("hmi_bh_init") int32_t hmi_bh_init(int32_t width_lu, int32_t height_lu, int32_t role) {
    const int count = hmi_tag_count > 0 ? hmi_tag_count : 1;
    g_values = static_cast<uint8_t **>(calloc(static_cast<size_t>(count), sizeof(uint8_t *)));
    g_known = static_cast<bool *>(calloc(static_cast<size_t>(count), sizeof(bool)));
    g_write_index = static_cast<uint32_t *>(calloc(static_cast<size_t>(count), sizeof(uint32_t)));
    if (!g_values || !g_known || !g_write_index) return -1;
    for (int i = 0; i < hmi_tag_count; i++) {
        g_values[i] = static_cast<uint8_t *>(calloc(hmi_tag_size(i), 1));
        if (!g_values[i]) return -1;
    }
    g_session = hmi_session_create();
    g_unit = g_session ? hmi_unit_create() : nullptr;
    if (!g_unit) return -1;
    hmi_set_tag_access(&g_access);
    hmi_session_use(g_session);
    hmi_core_init(width_lu, height_lu);
    hmi_unit_set_role(g_unit, role);
    return 0;
}

HMI_BH_EXPORT("hmi_bh_frame_ms") uint32_t hmi_bh_frame_ms(void) { return hmi_frame_ms; }

HMI_BH_EXPORT("hmi_bh_resize") void hmi_bh_resize(int32_t width_lu, int32_t height_lu) {
    hmi_session_use(g_session);
    hmi_set_screen_size(width_lu, height_lu);
}

/** Runs one frame at time_ms; returns the display list length. A screen fault traps. */
HMI_BH_EXPORT("hmi_bh_frame") uint32_t hmi_bh_frame(uint32_t time_ms) {
    hmi_session_use(g_session);
    hmi_set_time_ms(time_ms);
    hmi_frame_begin();
    hmi_unit_frame(g_unit);
    g_dl = hmi_frame_end(&g_dl_len);
    return static_cast<uint32_t>(g_dl_len);
}

/** The page whose screen ran in the last frame, -1 for none. */
HMI_BH_EXPORT("hmi_bh_page") int32_t hmi_bh_page(void) {
    hmi_session_use(g_session);
    return hmi_page_shown();
}

/** Whether the last frame's screen code asked to sign out. */
HMI_BH_EXPORT("hmi_bh_sign_out") int32_t hmi_bh_sign_out(void) {
    hmi_session_use(g_session);
    return hmi_frame_sign_out();
}

HMI_BH_EXPORT("hmi_bh_status") uint32_t hmi_bh_status(void) {
    hmi_session_use(g_session);
    return hmi_frame_status();
}

/**
 * Rasterizes the last frame into a w x h RGBA surface and returns its address, or 0 when memory is short or the
 * display list is bad. Only bands whose hash changed are drawn; hmi_bh_dirty_y0 and hmi_bh_dirty_rows give the span.
 */
HMI_BH_EXPORT("hmi_bh_render") uint8_t *hmi_bh_render(int32_t w, int32_t h, int32_t scale_q8) {
    g_dirty_y0 = 0;
    g_dirty_rows = 0;
    if (w <= 0 || h <= 0 || scale_q8 <= 0 || !g_dl || !prepare_surface(w, h, scale_q8)) return nullptr;
    uint32_t *current = g_surface.hashes;
    uint32_t *previous = g_surface.hashes + g_surface.bands;
    if (hmi_raster_band_hashes(g_dl, g_dl_len, w, h, HMI_BH_BAND_ROWS, scale_q8, 0, 0, current, g_surface.bands) !=
        HMI_RASTER_OK)
        return nullptr;
    int first = -1, last = -1;
    for (int b = 0; b < g_surface.bands; b++) {
        if (g_surface.valid && current[b] == previous[b]) continue;
        const int y0 = b * HMI_BH_BAND_ROWS;
        const int rows = h - y0 < HMI_BH_BAND_ROWS ? h - y0 : HMI_BH_BAND_ROWS;
        uint8_t *row = g_surface.rgba + static_cast<size_t>(y0) * static_cast<size_t>(w) * 4;
        if (hmi_raster_render(g_dl, g_dl_len, row, w, h, w, y0, rows, scale_q8, 0, 0) != HMI_RASTER_OK) {
            g_surface.valid = false;
            return nullptr;
        }
        if (first < 0) first = b;
        last = b;
    }
    memcpy(previous, current, static_cast<size_t>(g_surface.bands) * sizeof(uint32_t));
    g_surface.valid = true;
    if (first >= 0) {
        g_dirty_y0 = first * HMI_BH_BAND_ROWS;
        const int end = (last + 1) * HMI_BH_BAND_ROWS;
        g_dirty_rows = (end < h ? end : h) - g_dirty_y0;
    }
    return g_surface.rgba;
}

HMI_BH_EXPORT("hmi_bh_dirty_y0") int32_t hmi_bh_dirty_y0(void) { return g_dirty_y0; }
HMI_BH_EXPORT("hmi_bh_dirty_rows") int32_t hmi_bh_dirty_rows(void) { return g_dirty_rows; }

/** Element bounds of the last frame: hmi_bh_bounds_count records of (id, x, y, w, h), positions in Q4 lu. */
HMI_BH_EXPORT("hmi_bh_bounds_count") int32_t hmi_bh_bounds_count(void) {
    hmi_session_use(g_session);
    return hmi_bounds_count();
}

HMI_BH_EXPORT("hmi_bh_bounds") const int32_t *hmi_bh_bounds(void) {
    hmi_session_use(g_session);
    return hmi_bounds_data();
}

/** Pointer input in Q4 lu (HMI_PTR_* kinds). */
HMI_BH_EXPORT("hmi_bh_pointer") void hmi_bh_pointer(int32_t kind, int32_t x_q4, int32_t y_q4) {
    hmi_session_use(g_session);
    hmi_input_pointer(kind, x_q4, y_q4);
}

HMI_BH_EXPORT("hmi_bh_key") void hmi_bh_key(uint32_t code) {
    hmi_session_use(g_session);
    hmi_input_key(code);
}

/** Where the page writes a message of len bytes before hmi_bh_values; NULL when too large or memory is short. */
HMI_BH_EXPORT("hmi_bh_in") uint8_t *hmi_bh_in(uint32_t len) {
    if (len == 0 || len > HMI_BH_IN_MAX || !reserve(&g_in, len)) return nullptr;
    return g_in.data;
}

/**
 * Applies the VALUES payload of len bytes written at hmi_bh_in: `u16 page, u32 writes, u16 count` and count records.
 * Returns the page it was sent for, or -1 when it is malformed (nothing is applied then).
 */
HMI_BH_EXPORT("hmi_bh_values") int32_t hmi_bh_values(uint32_t len) {
    if (!g_in.data || len < HMI_BH_VALUES_HEADER || len > g_in.cap) return -1;
    const uint8_t *p = g_in.data;
    const int32_t page = static_cast<int32_t>(get_u16(p));
    const uint32_t writes = get_u32(p + 2);
    const uint32_t count = get_u16(p + 6);
    size_t off = HMI_BH_VALUES_HEADER;
    for (uint32_t i = 0; i < count; i++) {
        if (len - off < 4u) return -1;
        const uint32_t tag = get_u16(p + off);
        const uint32_t n = get_u16(p + off + 2);
        if (tag >= static_cast<uint32_t>(hmi_tag_count) || len - off - 4u < n) return -1;
        off += 4u + n;
    }
    if (off != len) return -1;
    off = HMI_BH_VALUES_HEADER;
    for (uint32_t i = 0; i < count; i++) {
        const int tag = static_cast<int>(get_u16(p + off));
        const uint32_t n = get_u16(p + off + 2);
        if (g_write_index[tag] <= writes) (void)store_wire(tag, p + off + 4, n);
        off += 4u + n;
    }
    return page;
}

/**
 * Writes queued since the last hmi_bh_out_clear, in the order screen code made them, as records `u16 page, u16 tag,
 * u8 kind, u8 bit, u16 len, bytes`: page is the screen shown when the write was made (0xFFFF none), kind 0 a whole
 * value, 1 one bit (value 0 or 1).
 */
HMI_BH_EXPORT("hmi_bh_out") const uint8_t *hmi_bh_out(void) { return g_out.data; }
HMI_BH_EXPORT("hmi_bh_out_len") uint32_t hmi_bh_out_len(void) { return static_cast<uint32_t>(g_out.len); }
HMI_BH_EXPORT("hmi_bh_out_clear") void hmi_bh_out_clear(void) { g_out.len = 0; }

/** Starts counting writes from 0, as the runtime does for a viewer it opens. */
HMI_BH_EXPORT("hmi_bh_reset_writes") void hmi_bh_reset_writes(void) {
    g_writes = 0;
    if (g_write_index) memset(g_write_index, 0, static_cast<size_t>(hmi_tag_count > 0 ? hmi_tag_count : 1) * 4u);
}
