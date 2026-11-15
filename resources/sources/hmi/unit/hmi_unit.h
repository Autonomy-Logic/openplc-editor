/**
 * @file hmi_unit.h
 * @brief What a generated HMI unit gives its host: program instances (one per viewer, run by hmi_unit_frame inside
 *        that viewer's core frame), the tag table, PLC variable access and project settings.
 */
#ifndef HMI_UNIT_H
#define HMI_UNIT_H

#include <stddef.h>
#include <stdint.h>

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
    /** PLC debug-table address (array, element); both 0 when the unit was built without a PLC program. */
    uint32_t arr;
    uint32_t elem;
    uint8_t type;       /**< ::hmi_tag_type */
    uint16_t max_len;   /**< declared length of a STRING, 0 otherwise */
    const char *path;   /**< canonical path, upper case: `CONFIG0.RES0.<INSTANCE>.<PROGRAM>.<NAME>`, `CONFIG0.<GLOBAL>` or
                             `<LIST>.<NAME>` */
} hmi_tag_t;

/**
 * How the unit reaches the PLC's variables. Screens read a tag straight from the PLC's variable, which the host
 * locates through the debug interface (the HMI runs in the PLC program's address space), and hand every write to the
 * host, which applies and logs it. Nothing is copied or buffered between frames.
 */
typedef struct {
    /** The PLC's variable object of a tag, as the debug interface locates it; NULL when it has none. */
    void *(*variable)(void *ctx, int tag);
    /** Applies a screen's write of a tag; `value` is a variable object of the tag's type holding the new value. */
    void (*write)(void *ctx, int tag, const void *value);
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

/** Installs the host's access to the PLC's variables, kept by reference; NULL makes the unit keep them itself. */
void hmi_set_tag_access(const hmi_tag_access_t *access);
/** Bytes a tag value takes in buffers: its IEC width, little endian, or max_len + 1 for a NUL-terminated STRING. */
size_t hmi_tag_size(int tag);
/**
 * Copies the value of a variable object of tag `tag` into buf (hmi_tag_size bytes); with variable NULL, the tag's
 * current value. Returns 0, or -1 for an unknown tag.
 */
int hmi_tag_read(int tag, const void *variable, void *buf);
/**
 * Sets a variable object of tag `tag` from buf; with variable NULL, the variable the unit keeps itself. For a STRING,
 * buf holds NUL-terminated text and at most max_len bytes of it are read. Returns 0, or -1 for an unknown tag.
 */
int hmi_tag_write(int tag, void *variable, const void *buf);

/** Bytes one program instance needs. */
size_t hmi_unit_size(void);
/** A program instance for one viewer, NULL when memory is short. */
void *hmi_unit_create(void);
void hmi_unit_destroy(void *unit);
/** Sets the viewer's role (::hmi_role) before its first frame; screens its role is not granted stay closed. */
void hmi_unit_set_role(void *unit, int role);
/** Runs one frame of the viewer's screens; the host brackets it with the viewer's hmi_frame_begin and end. */
void hmi_unit_frame(void *unit);

#ifdef __cplusplus
}
#endif

#endif
