/**
 * @file driver.c
 * A host for the sample project's HMI unit, in C, through hmi_unit.h only: a simulated PLC behind the host's tag
 * access, one program instance and core session per viewer, scripted input. Prints the tag table and settings,
 * then one line per frame with the page and display list hash, and every write a viewer's frame made. With a
 * directory argument, frames whose label ends in '!' are also written there as RGBA for review.
 * Usage: driver [dump-dir]
 */
#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "hmi_core.h"
#include "hmi_preview.h"
#include "hmi_unit.h"
#include "ids.h"
#include "setters.h"

#define VALUE_MAX 64

typedef struct {
    const char *name;
    hmi_session_t *session;
    void *unit;
} viewer_t;

static unsigned char g_plc[16][VALUE_MAX];
static uint32_t g_now;
static const char *g_dump_dir;

static void dump(const char *viewer, const char *label, const uint8_t *dl, size_t len) {
    int32_t wh[2] = {hmi_screen_w(), hmi_screen_h()};
    size_t n = (size_t)wh[0] * (size_t)wh[1] * 4;
    uint8_t *px = (uint8_t *)malloc(n);
    char path[512];
    if (!px) return;
    hmi_raster_render(dl, len, px, wh[0], wh[1], wh[0], 0, wh[1], 256, 0, 0);
    snprintf(path, sizeof path, "%s/%s_%s.rgba", g_dump_dir, viewer, label);
    FILE *f = fopen(path, "wb");
    if (f) {
        fwrite(wh, sizeof wh, 1, f);
        fwrite(px, 1, n, f);
        fclose(f);
    }
    free(px);
}

static void print_value(int tag, const unsigned char *v) {
    switch (hmi_tags[tag].type) {
    case HMI_TAG_BOOL: printf("%d", v[0]); break;
    case HMI_TAG_INT: { int16_t x; memcpy(&x, v, 2); printf("%d", x); break; }
    case HMI_TAG_REAL: { float x; memcpy(&x, v, 4); printf("%.2f", x); break; }
    case HMI_TAG_STRING: printf("'%s'", (const char *)v); break;
    default: printf("?"); break;
    }
}

static int g_writes[64];
static int g_write_count;
static int g_reads;
static int g_unreadable = -1;

/* The simulated PLC: each tag's value in its buffer format, read as screens use it; one tag can be unreadable. */
static bool plc_read(void *ctx, int tag, void *dest) {
    (void)ctx;
    g_reads++;
    if (tag == g_unreadable) return false;
    memcpy(dest, g_plc[tag], hmi_tag_size(tag));
    return true;
}

static void plc_write(void *ctx, int tag, const void *src) {
    (void)ctx;
    memset(g_plc[tag], 0, VALUE_MAX);
    memcpy(g_plc[tag], src, hmi_tag_size(tag));
    if (g_write_count < 64) g_writes[g_write_count++] = tag;
}

static const hmi_tag_access_t g_access = {plc_read, plc_write, NULL, NULL};

/* One frame of a viewer, reading the PLC's values as screens use them, then the writes it made. */
static void frame(viewer_t *v, const char *label) {
    hmi_session_use(v->session);
    g_write_count = 0;
    hmi_set_time_ms(g_now);
    g_now += 50;
    hmi_frame_begin();
    hmi_unit_frame(v->unit);
    size_t len = 0;
    const uint8_t *dl = hmi_frame_end(&len);
    size_t label_len = strlen(label);
    if (g_dump_dir && label_len > 0 && label[label_len - 1] == '!') dump(v->name, label, dl, len);
    printf("%s %s page=%d dl=%016llx status=%u", v->name, label, (int)hmi_page(),
           (unsigned long long)hmi_frame_hash(), (unsigned)hmi_frame_status());
    for (int i = 0; i < g_write_count; i++) {
        printf(" write %s=", hmi_tags[g_writes[i]].path);
        print_value(g_writes[i], g_plc[g_writes[i]]);
    }
    printf("\n");
}

static void centre_of(int32_t id, int32_t *x, int32_t *y) {
    const int32_t *b = hmi_bounds_data();
    for (int i = 0; i < hmi_bounds_count(); i++, b += 5) {
        if (b[0] != id) continue;
        *x = (b[1] + b[3] / 2) / 16;
        *y = (b[2] + b[4] / 2) / 16;
        return;
    }
    printf("element %d not drawn\n", (int)id);
    exit(1);
}

static void tap(viewer_t *v, const char *label, int32_t id) {
    int32_t x, y;
    char down[64], up[64];
    hmi_session_use(v->session);
    centre_of(id, &x, &y);
    snprintf(down, sizeof down, "%s_down", label);
    snprintf(up, sizeof up, "%s_up", label);
    hmi_input_pointer(HMI_PTR_DOWN, x * 16, y * 16);
    frame(v, down);
    hmi_session_use(v->session);
    hmi_input_pointer(HMI_PTR_UP, x * 16, y * 16);
    frame(v, up);
}

static int tag_of(const char *path) {
    for (int t = 0; t < hmi_tag_count; t++)
        if (strcmp(hmi_tags[t].path, path) == 0) return t;
    printf("no tag %s\n", path);
    exit(1);
}

static viewer_t viewer(const char *name, int role, int32_t w, int32_t h) {
    viewer_t v = {name, hmi_session_create(), hmi_unit_create()};
    if (!v.session || !v.unit) {
        printf("out of memory\n");
        exit(1);
    }
    hmi_session_use(v.session);
    hmi_core_init(w, h);
    hmi_unit_set_role(v.unit, role);
    return v;
}

int main(int argc, char **argv) {
    g_dump_dir = argc > 1 ? argv[1] : NULL;
    printf("tags %d md5=%s frame_ms=%u pin='%s' relock=%u\n", hmi_tag_count, hmi_plc_md5, (unsigned)hmi_frame_ms,
           hmi_panel_pin, (unsigned)hmi_relock_minutes);
    for (int t = 0; t < hmi_tag_count; t++)
        printf("tag %d %s arr=%u elem=%u type=%u max=%u size=%zu\n", t, hmi_tags[t].path, (unsigned)hmi_tags[t].arr,
               (unsigned)hmi_tags[t].elem, (unsigned)hmi_tags[t].type, (unsigned)hmi_tags[t].max_len, hmi_tag_size(t));
    if (hmi_tag_read(hmi_tag_count, NULL, g_plc[0]) != -1 || hmi_tag_write(-1, NULL, g_plc[0]) != -1)
        printf("unknown tag accepted\n");
    hmi_set_tag_access(&g_access);

    /* PLC values: instance0.Main.Level 6.5, instance0.Main.Tag 'TK-1'. */
    float level = 6.5f;
    memcpy(g_plc[tag_of("CONFIG0.RES0.INSTANCE0.MAIN.LEVEL")], &level, sizeof level);
    strcpy((char *)g_plc[tag_of("CONFIG0.RES0.INSTANCE0.MAIN.TAG")], "TK-1");

    viewer_t admin = viewer("admin", HMI_ROLE_ADMIN, 480, 320);
    frame(&admin, "start");
    frame(&admin, "steady!");
    tap(&admin, "run", ID_OVERVIEW_RUN);
    {
        int32_t x, y;
        hmi_session_use(admin.session);
        centre_of(ID_OVERVIEW_SPEED, &x, &y);
        hmi_input_pointer(HMI_PTR_DOWN, (x + 30) * 16, y * 16);
        frame(&admin, "slider_down");
        hmi_session_use(admin.session);
        hmi_input_pointer(HMI_PTR_UP, (x + 30) * 16, y * 16);
        frame(&admin, "slider_up");
    }
    tap(&admin, "name", ID_OVERVIEW_NAME);
    hmi_session_use(admin.session);
    for (const char *k = "\b\b\b\bPUMP STATION 7\r"; *k; k++) hmi_input_key((uint32_t)(unsigned char)*k);
    frame(&admin, "name_typed!");
    /* Entries outside the INT's range write its nearest value; a non-number writes nothing. */
    const char *entries[] = {"\b\b\b\b\b\b40000\r", "\b\b\b\b\b\b-1e30\r", "\b\b\b\b\b\binf\r", "\b\b\b\b\b\b12\r"};
    for (int e = 0; e < 4; e++) {
        tap(&admin, "setpoint", ID_OVERVIEW_SETPOINT);
        hmi_session_use(admin.session);
        for (const char *k = entries[e]; *k; k++) hmi_input_key((uint32_t)(unsigned char)*k);
        frame(&admin, "setpoint_typed");
    }
    tap(&admin, "next", ID_OVERVIEW_NEXT);
    frame(&admin, "details!");
    tap(&admin, "back", ID_DETAILS_BACK);
    frame(&admin, "overview_again");

    /* An operator may not open Details: the button does nothing. */
    viewer_t op = viewer("operator", HMI_ROLE_OPERATOR, 320, 240);
    frame(&op, "start!");
    tap(&op, "next", ID_OVERVIEW_NEXT);
    frame(&op, "still_overview");

    /* A role the grid does not know opens nothing. */
    viewer_t other = viewer("unknown", 9, 320, 240);
    frame(&other, "start!");

    /* The admin's state is its own. */
    frame(&admin, "admin_after");

    /* Viewers show different screens at once, each built in its own instance's slot; a hidden screen takes no edit. */
    tap(&admin, "next_again", ID_OVERVIEW_NEXT);
    frame(&op, "op_on_overview");
    frame(&admin, "admin_on_details");
    frame(&op, "op_still_overview");
    printf("hidden screen setter=%d\n", hmi_unit_set_num(admin.unit, 0, SET_OVERVIEW_LEVEL_MAXVALUE, 5.0));
    tap(&admin, "back_again", ID_DETAILS_BACK);
    frame(&admin, "admin_back");

    /* Preview: literal properties change without a build; unknown screens and setters are refused. */
    int rc = hmi_unit_set_num(admin.unit, 0, SET_OVERVIEW_LEVEL_MAXVALUE, 20.0);
    rc |= hmi_unit_set_num(admin.unit, 0, SET_OVERVIEW_COL_GAP, 40.0);
    rc |= hmi_unit_set_str(admin.unit, 0, SET_OVERVIEW_NEXT_TEXT, "Go on");
    rc |= hmi_unit_set_num(admin.unit, 0, SET_OVERVIEW_NEXT_VISIBLE, 1.0);
    printf("setters rc=%d refused=%d %d %d\n", rc, hmi_unit_set_num(admin.unit, 7, 0, 1.0),
           hmi_unit_set_num(admin.unit, 0, 9999, 1.0), hmi_unit_set_str(NULL, 0, 0, "x"));
    frame(&admin, "live_edit!");

    /* Reads reach the host when a value is used, with no frame; an unreadable tag keeps the value last read. */
    int level_tag = tag_of("CONFIG0.RES0.INSTANCE0.MAIN.LEVEL");
    unsigned char got[VALUE_MAX];
    g_reads = 0;
    frame(&admin, "reads");
    printf("frame read the host %s\n", g_reads > 0 ? "yes" : "no");
    level = 7.25f;
    memcpy(g_plc[level_tag], &level, sizeof level);
    g_reads = 0;
    hmi_tag_read(level_tag, NULL, got);
    printf("read level=");
    print_value(level_tag, got);
    printf(" reads=%d\n", g_reads);
    g_unreadable = level_tag;
    level = 9.5f;
    memcpy(g_plc[level_tag], &level, sizeof level);
    hmi_tag_read(level_tag, NULL, got);
    printf("unreadable level=");
    print_value(level_tag, got);
    printf("\n");
    g_unreadable = -1;
    hmi_tag_read(level_tag, NULL, got);
    printf("readable again level=");
    print_value(level_tag, got);
    printf("\n");

    /* A host STRING buffer with no NUL within max_len + 1 bytes is cut at max_len. */
    int tag = tag_of("CONFIG0.RES0.INSTANCE0.MAIN.TAG");
    memcpy(g_plc[tag], "ABCDEFGHIJKLMNOPQRSTUVWXYZ", 26);
    hmi_tag_read(tag, NULL, got);
    printf("host cut '%s'\n", (const char *)got);

    /* Access missing a callback counts as none: the unit keeps the variables itself and never calls the host. */
    static const hmi_tag_access_t half = {plc_read, NULL, NULL, NULL};
    hmi_set_tag_access(&half);
    g_reads = 0;
    hmi_tag_read(level_tag, NULL, got);
    printf("half access reads=%d\n", g_reads);

    /* Without host access the unit keeps the variables itself, as in the preview. */
    hmi_set_tag_access(NULL);

    /* A STRING longer than its declared length is cut; a short one is read only up to its end. */
    unsigned char text[VALUE_MAX] = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    unsigned char back[VALUE_MAX];
    hmi_tag_write(tag, NULL, text);
    hmi_tag_read(tag, NULL, back);
    printf("cut '%s'\n", (const char *)back);
    char *shortText = (char *)malloc(3);
    if (shortText) {
        memcpy(shortText, "AB", 3);
        hmi_tag_write(tag, NULL, shortText);
        free(shortText);
        hmi_tag_read(tag, NULL, back);
        printf("short '%s'\n", (const char *)back);
    }

    hmi_unit_destroy(admin.unit);
    hmi_unit_destroy(op.unit);
    hmi_unit_destroy(other.unit);
    hmi_session_destroy(admin.session);
    hmi_session_destroy(op.session);
    hmi_session_destroy(other.session);
    printf("unit size %s\n", hmi_unit_size() > 0 ? "known" : "missing");
    return 0;
}
