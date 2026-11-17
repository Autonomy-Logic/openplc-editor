/**
 * @file hmi_unit.h
 * @brief What a generated HMI unit gives its host: program instances (one per viewer, run by hmi_unit_frame inside
 *        that viewer's core frame), the tag table, PLC variable access and project settings. The unit keeps shared,
 *        unsynchronized state: the host makes every call from one thread at a time.
 */
#ifndef HMI_UNIT_H
#define HMI_UNIT_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#if defined(__has_include)
#if __has_include("hmi_config.h")
#include "hmi_config.h"
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

/** Roles, as the runtime's accounts name them. A panel without accounts runs its viewer as admin. */
enum hmi_role { HMI_ROLE_ADMIN = 0, HMI_ROLE_ENGINEER = 1, HMI_ROLE_OPERATOR = 2, HMI_ROLE_VIEWER = 3 };

/** Value types of tags; numbers are stored little endian in their IEC width. */
enum hmi_tag_type {
    HMI_TAG_BOOL = 1, /**< 1 byte, 0 or 1 */
    HMI_TAG_SINT,
    HMI_TAG_INT,
    HMI_TAG_DINT,
    HMI_TAG_LINT,
    HMI_TAG_USINT,
    HMI_TAG_UINT,
    HMI_TAG_UDINT,
    HMI_TAG_ULINT,
    HMI_TAG_BYTE,
    HMI_TAG_WORD,
    HMI_TAG_DWORD,
    HMI_TAG_LWORD,
    HMI_TAG_REAL,
    HMI_TAG_LREAL,
    HMI_TAG_STRING /**< up to max_len bytes, NUL terminated in buffers */
};

typedef struct {
    /** PLC debug-table address (array, element); both 0 only when the unit was built without a PLC program. */
    uint32_t arr;
    uint32_t elem;
    uint8_t type;       /**< ::hmi_tag_type */
    uint16_t max_len;   /**< declared length of a STRING, 0 otherwise */
    const char *path;   /**< canonical path, upper case: `CONFIG0.RES0.<INSTANCE>.<PROGRAM>.<NAME>`, `CONFIG0.<GLOBAL>` or
                             `<LIST>.<NAME>` */
} hmi_tag_t;

/**
 * How the unit reaches the PLC's variables. Screens read a tag through `read` at the moment they use it and hand every
 * write to `write`, which applies and logs it. Values cross in their buffer format (see hmi_tag_size), so the host can
 * serve them from the debug interface by (arr, elem). The unit keeps each tag's last read value, shared by all its
 * instances, and uses it when a read fails. Both callbacks are required.
 */
typedef struct {
    /** Copies the tag's current value into dest in its buffer format (hmi_tag_size bytes); false when unreadable. */
    bool (*read)(void *ctx, int tag, void *dest);
    /** Applies a screen's write of the tag; src holds the new value in its buffer format. */
    void (*write)(void *ctx, int tag, const void *src);
    void *ctx;
} hmi_tag_access_t;

extern const hmi_tag_t hmi_tags[];
extern const int hmi_tag_count;
/** MD5 of the PLC program the unit was built against; empty when built without one. */
extern const char hmi_plc_md5[];

/** Frame period from HMI Settings, in milliseconds. */
extern const uint32_t hmi_frame_ms;
/** Local-panel PIN, empty when the PIN is disabled. */
extern const char hmi_panel_pin[];
/** Idle minutes after which an unlocked panel locks again; 0 means only at startup. */
extern const uint32_t hmi_relock_minutes;

/**
 * Installs the host's access to the PLC's variables, kept by reference. NULL, or access missing either callback, makes
 * the unit keep the variables itself (the preview, where no PLC runs).
 */
void hmi_set_tag_access(const hmi_tag_access_t *access);
/** Bytes a tag value takes in buffers: its IEC width, little endian, or max_len + 1 for a NUL-terminated STRING. */
size_t hmi_tag_size(int tag);
/**
 * Copies the value of a variable object of tag `tag` into buf (hmi_tag_size bytes); with variable NULL, the tag's
 * current value, through the host's read when access is installed. Returns 0, or -1 for an unknown tag.
 */
int hmi_tag_read(int tag, const void *variable, void *buf);
/**
 * Sets a variable object of tag `tag` from buf; with variable NULL, the variable the unit keeps itself, which screens
 * read only while no access is installed. For a STRING, buf holds NUL-terminated text and at most max_len bytes of it
 * are read. Returns 0, or -1 for an unknown tag.
 */
int hmi_tag_write(int tag, void *variable, const void *buf);

/** Bytes one program instance needs: the program and one screen slot as large as the largest screen. */
size_t hmi_unit_size(void);
/**
 * A program instance for one viewer, NULL when memory is short; with HMI_STATIC_MEMORY one static instance at a time.
 * Only the screen it shows exists, built in the instance's own slot when shown and destroyed when left.
 */
void *hmi_unit_create(void);
/** Ends an instance from hmi_unit_create. */
void hmi_unit_destroy(void *unit);
/** Sets the viewer's role (::hmi_role) before its first frame; screens its role is not granted stay closed. */
void hmi_unit_set_role(void *unit, int role);
/** Whether the next hmi_unit_frame builds a screen: the first frame, or a page change asked for in the last one. */
bool hmi_unit_mount_pending(void *unit);
/**
 * Runs one frame of the viewer's screens; the host brackets it with the viewer's hmi_frame_begin and end.
 * Returns false when the screen code raised an IEC fault (null reference, array bounds): in builds with
 * C++ exceptions the unit catches it here, so it never reaches the host; the host then closes the viewer. A host built
 * without exceptions must define the C++ hook `strucpp::iec_runtime_fault`, which then receives the fault.
 */
bool hmi_unit_frame(void *unit);

#ifdef __cplusplus
}
#endif

#endif
