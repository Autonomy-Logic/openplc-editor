/**
 * @file hmi_access.h
 * @brief What an HMI build gives the Runtime v4 HMI host: the PLC variables the screens use, which screen reads and
 *        writes which of them, and which roles may open each screen. The host serves a browser viewer only the tags
 *        of the screen it shows and applies only that screen's writes; the browser runs the screens themselves.
 *        Generated as data only (`hmi_access.c`); the host never runs screen code.
 */
#ifndef HMI_ACCESS_H
#define HMI_ACCESS_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** Value types of tags: the values of hmi_tag_type in hmi_unit.h. */
enum hmi_access_type {
    HMI_ACCESS_BOOL = 1,
    HMI_ACCESS_SINT,
    HMI_ACCESS_INT,
    HMI_ACCESS_DINT,
    HMI_ACCESS_LINT,
    HMI_ACCESS_USINT,
    HMI_ACCESS_UINT,
    HMI_ACCESS_UDINT,
    HMI_ACCESS_ULINT,
    HMI_ACCESS_BYTE,
    HMI_ACCESS_WORD,
    HMI_ACCESS_DWORD,
    HMI_ACCESS_LWORD,
    HMI_ACCESS_REAL,
    HMI_ACCESS_LREAL,
    HMI_ACCESS_STRING,
    HMI_ACCESS_TIME,
    HMI_ACCESS_LTIME,
    HMI_ACCESS_DATE,
    HMI_ACCESS_TOD,
    HMI_ACCESS_DT
};

/** A PLC variable screens use; its index in hmi_access_tags is its tag id. */
typedef struct {
    uint32_t arr;     /**< PLC debug-table array */
    uint32_t elem;    /**< PLC debug-table element */
    uint8_t type;     /**< ::hmi_access_type */
    uint16_t max_len; /**< declared length of a STRING, 0 otherwise */
    const char *path; /**< canonical path, upper case, for logs */
} hmi_access_tag_t;

/** How one screen writes one tag. */
typedef struct {
    uint16_t tag;
    /** 1 when screen code writes the whole value; 0 when it only assigns bits. */
    uint8_t whole;
    /** Bits screen code assigns one at a time (`Tag.3 := ...`), bit n as 1 << n; applied to the PLC's current value. */
    uint64_t bits;
    /**
     * 1 when whole values are limited to min..max: the range of the two-way widgets bound to the tag and the literals
     * screen code assigns it, in the tag's values (a STRING's length in bytes). 0 when screen code may write any value
     * of the type. Conditions in screen code are not limits.
     */
    uint8_t limited;
    double min;
    double max;
} hmi_access_write_t;

/** One screen, by page number: the tags it reads (ascending), how it writes tags (ascending tag) and its roles. */
typedef struct {
    const uint16_t *reads;
    uint16_t read_count;
    const hmi_access_write_t *writes;
    uint16_t write_count;
    /** One bit per role (bit 0 admin, 1 engineer, 2 operator, 3 viewer); admin is always set. */
    uint8_t roles;
} hmi_access_page_t;

extern const hmi_access_tag_t hmi_access_tags[];
extern const int hmi_access_tag_count;
extern const hmi_access_page_t hmi_access_pages[];
extern const int hmi_access_page_count;
/** MD5 of the PLC program the screens were built against. */
extern const char hmi_access_plc_md5[];
/** The screens' frame period from HMI Settings, in milliseconds: how often values are sent. */
extern const uint32_t hmi_access_period_ms;

#ifdef __cplusplus
}
#endif

#endif
