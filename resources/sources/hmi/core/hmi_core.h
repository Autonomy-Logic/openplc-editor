/**
 * @file hmi_core.h
 * @brief HMI core: primitives, display list, sessions, input and rasterizer.
 *
 * Screens are ST programs that call the primitives below once per frame. The primitives record a display list in
 * Q4 fixed point (1/16 logical unit); the rasterizer replays it into RGBA pixels. Geometry, colors and text widths
 * are integers, so every target (gcc, clang, WebAssembly, microcontrollers) produces the same pixels from the same
 * display list. The display list is also the wire format sent to remote displays.
 *
 * Units: lengths are whole logical units (lu, int32) and angles whole degrees, clockwise from 3 o'clock. A host
 * shows lu at a density it chooses (device pixels per lu, Q8 in the rasterizer).
 *
 * Threading: the core is single threaded. One thread records every session and runs the rasterizer.
 *
 * Display list layout (little endian):
 *   header: u32 magic "HMDL", u16 version, u16 flags (0), i32 width_lu, i32 height_lu, u32 command count;
 *   then per command: u8 op and its payload, listed with ::hmi_op. Coordinates and lengths are Q4 screen units,
 *   arc angles Q6 degrees, colors ARGB with alpha in the top byte.
 */
#ifndef HMI_CORE_H
#define HMI_CORE_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

#define HMI_DL_MAGIC 0x4C444D48u /* "HMDL" */
#define HMI_DL_VERSION 1u
#define HMI_DL_HEADER_SIZE 20u

/** Display list opcodes and their payloads. */
enum hmi_op {
    HMI_OP_CLEAR = 1,       /**< u32 color */
    HMI_OP_RECT = 2,        /**< i32 x y w h radius, u32 color */
    HMI_OP_RECT_STROKE = 3, /**< i32 x y w h radius width, u32 color */
    HMI_OP_LINE = 4,        /**< i32 x1 y1 x2 y2 width, u32 color */
    HMI_OP_CIRCLE = 5,      /**< i32 cx cy r, u32 color */
    HMI_OP_ARC = 6,         /**< i32 cx cy r width a0 a1 (Q6 degrees), u32 color */
    HMI_OP_TEXT = 7,        /**< i32 x y size, u8 font, u8 align, u32 color, u16 len, len bytes UTF-8 */
    HMI_OP_CLIP = 8,        /**< i32 x y w h */
    HMI_OP_UNCLIP = 9,      /**< no payload */
    HMI_OP_POLY = 10        /**< u32 color, u16 n (3..HMI_POLY_MAX), n * (i32 x, i32 y) */
};

/** Most points of one polygon, in the core and on the wire. */
#define HMI_POLY_MAX 64
/** Most bytes of one text command. */
#define HMI_TEXT_MAX_BYTES 255

enum hmi_align { HMI_ALIGN_LEFT = 0, HMI_ALIGN_CENTER = 1, HMI_ALIGN_RIGHT = 2 };
enum hmi_valign { HMI_VALIGN_TOP = 0, HMI_VALIGN_MIDDLE = 1, HMI_VALIGN_BOTTOM = 2 };

/** Font faces. A build includes only the faces its screens use; text in a missing face uses another one. */
enum hmi_font { HMI_FONT_REGULAR = 0, HMI_FONT_BOLD = 1, HMI_FONTS };

enum hmi_ptr_kind { HMI_PTR_DOWN = 0, HMI_PTR_MOVE = 1, HMI_PTR_UP = 2 };

/* Special key codes; printable keys use their Unicode code point. */
#define HMI_KEY_BACKSPACE 8
#define HMI_KEY_ENTER 13
#define HMI_KEY_ESCAPE 27
#define HMI_KEY_DELETE 127

/* ------------------------------------------------------------------------------------------------------------ */
/* Host side: sessions, frame life cycle and input                                                              */
/* ------------------------------------------------------------------------------------------------------------ */

/** Everything one viewer needs. Hosts with one viewer use the default session and never create one. */
typedef struct hmi_session hmi_session_t;

/** Allocates a session (NULL when memory is short). Its screen size is 0 until hmi_core_init. */
hmi_session_t *hmi_session_create(void);
/** Frees a session created by hmi_session_create; the session in use falls back to the default one. */
void hmi_session_destroy(hmi_session_t *s);
/** Makes s the session every other call acts on; NULL selects the default session. */
void hmi_session_use(hmi_session_t *s);
/** Size of one session in bytes, for hosts that check memory before creating one. */
size_t hmi_session_size(void);

/** Sets the logical screen size and empties the input queues of the session in use. */
void hmi_core_init(int32_t width_lu, int32_t height_lu);
/** Changes the logical screen size, keeping input and page state. */
void hmi_set_screen_size(int32_t width_lu, int32_t height_lu);
/** Queues a pointer event at (x, y) in Q4 screen units. Consecutive moves are merged; a full queue drops it. */
void hmi_input_pointer(int kind, int32_t x_q4, int32_t y_q4);
/** Queues a key (see HMI_KEY_*); a full queue drops it. */
void hmi_input_key(uint32_t code);
/** Sets the time screens read through hmi_time_ms. */
void hmi_set_time_ms(uint32_t ms);

/** Starts a frame: empties the display list and applies queued pointer events up to one press or release. */
void hmi_frame_begin(void);
/** Ends a frame and returns its display list (header included) and length. */
const uint8_t *hmi_frame_end(size_t *len);
/** 64-bit FNV-1a hash of the current display list, for hosts that skip unchanged frames. */
uint64_t hmi_frame_hash(void);

/** Bits of hmi_frame_status: what the last frame could not record. */
#define HMI_STATUS_DL_FULL 0x1u        /**< commands were dropped: display list capacity reached */
#define HMI_STATUS_POLY_FULL 0x2u      /**< polygon points beyond HMI_POLY_MAX were dropped */
#define HMI_STATUS_BOUNDS_FULL 0x4u    /**< element bounds beyond the table capacity were dropped */
#define HMI_STATUS_TEXT_TRUNCATED 0x8u /**< a text longer than HMI_TEXT_MAX_BYTES was cut */
/** What went wrong while recording the current frame (0 = nothing). */
uint32_t hmi_frame_status(void);

/* ------------------------------------------------------------------------------------------------------------ */
/* Colors and themes                                                                                            */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * A color is 16#RRGGBB (fixed) or a theme token: bit 31 set and the token in the low byte (HMI_TOKEN_*). Bits 24-30
 * hold the transparency in percent (0 = opaque, see hmi_alpha). Tokens resolve through the session's theme when a
 * primitive is recorded, so the display list carries plain ARGB.
 */
enum hmi_token {
    HMI_TOKEN_BACKGROUND = 1,
    HMI_TOKEN_SURFACE,
    HMI_TOKEN_TEXT,
    HMI_TOKEN_TEXT_MUTED,
    HMI_TOKEN_BORDER,
    HMI_TOKEN_FILL,
    HMI_TOKEN_ACCENT,
    HMI_TOKEN_ON_ACCENT,
    HMI_TOKEN_SUCCESS,
    HMI_TOKEN_WARNING,
    HMI_TOKEN_DANGER,
    HMI_TOKEN_BAR,
    HMI_TOKEN_ON_BAR,
    HMI_TOKENS
};
#define HMI_COLOR_TOKEN 0x80000000u
/** Predefined themes: 0 Autonomy, 1 Light, 2 Dark, 3 Classic, 4 Ocean. Project themes use the ids after these. */
#define HMI_THEMES_BUILTIN 5
/** Most themes, predefined ones included. */
#define HMI_THEMES_MAX 16

/** Starts theme `theme` (>= HMI_THEMES_BUILTIN) as a copy of the predefined theme `base`. */
void hmi_theme_copy(int32_t theme, int32_t base);
/** Sets one token of a project theme to 16#RRGGBB. */
void hmi_theme_define(int32_t theme, int32_t token, uint32_t rgb);
/** Selects the theme of the session in use; an unknown id selects theme 0. */
void hmi_theme_use(int32_t theme);
int32_t hmi_theme_current(void);
/** Returns color with the given opacity (0..100 percent). */
uint32_t hmi_alpha(uint32_t color, int32_t opacity_pct);

/* ------------------------------------------------------------------------------------------------------------ */
/* Primitives (called from ST)                                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */

void hmi_clear(uint32_t color);
void hmi_fill_rect(int32_t x, int32_t y, int32_t w, int32_t h, int32_t radius, uint32_t color);
void hmi_stroke_rect(int32_t x, int32_t y, int32_t w, int32_t h, int32_t radius, int32_t width, uint32_t color);
void hmi_line(int32_t x1, int32_t y1, int32_t x2, int32_t y2, int32_t width, uint32_t color);
void hmi_fill_circle(int32_t cx, int32_t cy, int32_t r, uint32_t color);
void hmi_stroke_circle(int32_t cx, int32_t cy, int32_t r, int32_t width, uint32_t color);
/** Arc of radius r and stroke width, from a0 to a1 degrees clockwise. */
void hmi_arc(int32_t cx, int32_t cy, int32_t r, int32_t width, int32_t a0_deg, int32_t a1_deg, uint32_t color);
/** Filled ellipse, a 32-point polygon from a constant table. */
void hmi_ellipse(int32_t cx, int32_t cy, int32_t rx, int32_t ry, uint32_t color);
void hmi_stroke_ellipse(int32_t cx, int32_t cy, int32_t rx, int32_t ry, int32_t width, uint32_t color);
/** Text with its top at y, anchored at x by align (::hmi_align). len < 0 means NUL terminated. */
void hmi_text(int32_t x, int32_t y, const char *s, int len, int32_t size, int font, int align, uint32_t color);
/** Text aligned inside a box (::hmi_align, ::hmi_valign). */
void hmi_text_box(int32_t x, int32_t y, int32_t w, int32_t h, const char *s, int len, int32_t size, int font,
                  int halign, int valign, uint32_t color);
/** Text advance in lu, rounded up. */
int32_t hmi_text_width(const char *s, int len, int32_t size, int font);
/** Limits drawing to a rectangle, intersected with the frame's clip. */
void hmi_clip(int32_t x, int32_t y, int32_t w, int32_t h);
/** Back to the frame's clip, or to the whole screen. */
void hmi_unclip(void);

/** Starts a polygon; hmi_poly_point adds points and hmi_poly_end fills them, or hmi_poly_stroke strokes them. */
void hmi_poly_begin(uint32_t color);
void hmi_poly_point(int32_t x, int32_t y);
void hmi_poly_end(void);
/** Strokes the points given since hmi_poly_begin, closed back to the first point when closed != 0. */
void hmi_poly_stroke(int32_t width, int closed);

/** amp * sin(deg) and amp * cos(deg), rounded, from a constant one-degree table: the HMI's only trigonometry. */
int32_t hmi_sin(int32_t deg, int32_t amp);
int32_t hmi_cos(int32_t deg, int32_t amp);
/** Writes v in decimal into buf (NUL terminated, at most size - 1 characters); returns the length. */
int hmi_format_int(char *buf, int size, int32_t v);
/**
 * Writes v with d decimals (0..6) into buf like printf "%.*f", rounding half to even, using integer arithmetic for
 * |v| < 2^32. Returns the length.
 */
int hmi_format_real(char *buf, int size, float v, int d);

int32_t hmi_screen_w(void);
int32_t hmi_screen_h(void);
uint32_t hmi_time_ms(void);

/* ------------------------------------------------------------------------------------------------------------ */
/* Frames: scaled and clipped drawing for diagrams                                                              */
/* ------------------------------------------------------------------------------------------------------------ */

/**
 * Sets the frame of the element being drawn: primitives, clips, pointer reads and bounds map local units to screen
 * units as screen_q4 = local_q4 * k_q16 / 65536 + (ox_q4, oy_q4). With clip != 0, drawing and pointer reads are
 * limited to the screen rectangle (cx, cy, cw, ch) in Q4. k_q16 <= 0 means 1.0.
 */
void hmi_frame_set(int32_t k_q16, int32_t ox_q4, int32_t oy_q4, int clip, int32_t cx_q4, int32_t cy_q4,
                   int32_t cw_q4, int32_t ch_q4);
void hmi_frame_reset(void);
/** Emits the frame's clip into the display list. */
void hmi_frame_clip(void);
/** Design mode: set by designers so elements also record their connection ports as bounds. */
void hmi_set_design_mode(int on);
int hmi_design_mode(void);

/* ------------------------------------------------------------------------------------------------------------ */
/* Pointer, keyboard, element bounds and pages                                                                  */
/* ------------------------------------------------------------------------------------------------------------ */

/** Returned by hmi_ptr_x/y when the pointer is outside the frame's clip. */
#define HMI_PTR_AWAY (-1000000000)
/** Smallest touch area, in lu: input elements smaller than this take presses in a centred square of this size. */
#define HMI_MIN_TOUCH_LU 28

/** Pointer position in the frame's local lu, rounded toward minus infinity. */
int32_t hmi_ptr_x(void);
int32_t hmi_ptr_y(void);
int hmi_ptr_down(void);
/** The pointer went down this frame and no element consumed the press. */
int hmi_ptr_pressed(void);
int hmi_ptr_released(void);
/** Claims this frame's press so elements drawn later ignore it. */
void hmi_ptr_consume(void);
int hmi_ptr_consumed(void);
/**
 * Id of the input element that owns the pointer this frame, from the previous frame's bounds: the last-drawn one
 * whose bounds contain the pointer, else the nearest one whose touch area contains it; 0 = none.
 */
int32_t hmi_ptr_owner(void);

/** Records an element's bounds (local lu) for designers and pointer arbitration. */
void hmi_elem_bounds(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h);
/** Same, marking whether the element takes pointer input. */
void hmi_elem_bounds_in(int32_t id, int32_t x, int32_t y, int32_t w, int32_t h, int takes_input);
int hmi_bounds_count(void);
/** count * 5 values: id, then x, y, w, h in Q4 screen units. */
const int32_t *hmi_bounds_data(void);

/** Next queued key, 0 when none. */
uint32_t hmi_key_next(void);

/** Most bytes of the on-screen keyboard text and title, NUL included. */
#define HMI_KBD_TEXT_MAX 256
#define HMI_KBD_TITLE_MAX 64
/** Opens the session's on-screen keyboard for element `owner`, starting from text. */
void hmi_kbd_open(int32_t owner, const char *text, int text_len, const char *title, int title_len, int numeric);
int hmi_kbd_is_open(void);
int hmi_kbd_numeric(void);
/** Element the keyboard edits, while open or until its result is taken; 0 otherwise. */
int32_t hmi_kbd_owner(void);
const char *hmi_kbd_text(void);
const char *hmi_kbd_title(void);
void hmi_kbd_set_text(const char *text, int len);
/** Closes the keyboard; accepted != 0 makes the text available to hmi_kbd_take. */
void hmi_kbd_close(int accepted);
/** Returns 1 once for `owner` after the keyboard closed with OK. */
int hmi_kbd_take(int32_t owner);

/** Page (screen) shown by the session. */
int32_t hmi_page(void);
/** Shows another page, remembering the current one for hmi_page_back (8 levels). */
void hmi_set_page(int32_t page);
/** Back to the previous page; returns 0 when there is none. */
int hmi_page_back(void);

/* ------------------------------------------------------------------------------------------------------------ */
/* Rasterizer (not thread safe: glyph cache and scratch buffers are shared)                                    */
/* ------------------------------------------------------------------------------------------------------------ */

/** Results of the rasterizer. */
#define HMI_RASTER_OK 0
#define HMI_RASTER_ABORTED 1     /**< the deadline passed; the band is incomplete */
#define HMI_RASTER_BAD_LIST (-1) /**< not a display list: bad header */
#define HMI_RASTER_MALFORMED (-2) /**< a command is truncated or unknown */
#define HMI_RASTER_BAD_ARGS (-3) /**< surface or band parameters are invalid */

/**
 * Renders a display list into RGBA8888 (bytes R, G, B, A) rows [band_y0, band_y0 + band_h) of an out_w x out_h
 * device surface. rgba points at the first byte of row band_y0; stride is in pixels. scale_q8 is device pixels per
 * lu in Q8 (256 = 1x); (offset_x, offset_y) is added in device pixels.
 */
int hmi_raster_render(const uint8_t *dl, size_t len, uint8_t *rgba, int out_w, int out_h, int stride, int band_y0,
                      int band_h, int32_t scale_q8, int32_t offset_x, int32_t offset_y);

/** Monotonic microsecond clock for deadlines; wrap-around is handled. */
typedef uint32_t (*hmi_clock_fn)(void);
/**
 * hmi_raster_render with a deadline: stops between commands, rows and glyphs once clock() reaches deadline_us and
 * returns HMI_RASTER_ABORTED, leaving the band incomplete for the host to discard and retry. clock NULL: no deadline.
 */
int hmi_raster_render_until(const uint8_t *dl, size_t len, uint8_t *rgba, int out_w, int out_h, int stride,
                            int band_y0, int band_h, int32_t scale_q8, int32_t offset_x, int32_t offset_y,
                            hmi_clock_fn clock, uint32_t deadline_us);

/**
 * One hash per band of band_h device rows (nbands of them) over the commands that can reach the band and the clip
 * they draw through. A band whose hash did not change since the last frame renders to the same pixels, so a host can
 * skip its raster and transfer. Returns HMI_RASTER_OK or a negative HMI_RASTER_* error.
 */
int hmi_raster_band_hashes(const uint8_t *dl, size_t len, int out_w, int out_h, int band_h, int32_t scale_q8,
                           int32_t offset_x, int32_t offset_y, uint32_t *hashes, int nbands);

/** Line height (ascent - descent) in Q4 for a Q4 size. */
int32_t hmi_font_line_height_q4(int font, int32_t size_q4);
/** Text advance in Q4 for a Q4 size, from the font's integer advances and kerning. */
int32_t hmi_font_text_width_q4(int font, const char *s, int len, int32_t size_q4);

#ifdef __cplusplus
}
#endif

#endif
