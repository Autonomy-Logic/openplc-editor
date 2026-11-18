/**
 * @file hmi_preview.h
 * @brief Live property setters of a generated HMI unit, for the editor's preview only; product hosts do not link them.
 *
 * The build numbers the literal properties of each screen's elements (see the setter table it returns). A preview
 * applies an edit of such a value without a new build: the next frame draws with it. It also adds elements of any
 * widget type to the shown screen without a build (hmi_unit_live_add), which the next build then compiles in.
 */
#ifndef HMI_PREVIEW_H
#define HMI_PREVIEW_H

#ifdef __cplusplus
extern "C" {
#endif

/** Sets numeric or BOOL setter `setter` of screen `screen` (page number); returns 0, or -1 when there is none or the
 * screen is not the one built in the unit's slot (not shown). */
int hmi_unit_set_num(void *unit, int screen, int setter, double value);
/** Sets STRING setter `setter` of screen `screen`; a longer text is cut to the property's length. */
int hmi_unit_set_str(void *unit, int screen, int setter, const char *value);

/** Containers a live element can go into (hmi_unit_live_add). */
enum hmi_live_container { HMI_LIVE_STACK = 1, HMI_LIVE_DIAGRAM = 2 };

/**
 * Creates an element of widget type `type` (its number in the unit's factory table) on the shown screen, as the next
 * build will: inside container `parent` (an element id; 0 is the screen's own stack) of kind `parent_kind`
 * (::hmi_live_container), before its child `before` (0: last), and drawn before element `draw_before` (0: last). Its
 * inputs keep their declared defaults until set with hmi_unit_live_set_num and _str. Returns the new element's id, or
 * -1 when no screen is shown, a container is full, an id is unknown or memory is short. Live elements end when the
 * shown screen is left (hmi_unit_live_sync).
 */
int hmi_unit_live_add(void *unit, int type, int parent, int parent_kind, int before, int draw_before);
/** Sets numeric or BOOL setter `setter` (the factory table's number) of live element `element`; 0, or -1. */
int hmi_unit_live_set_num(void *unit, int element, int setter, double value);
/** Sets STRING setter `setter` of live element `element`; a longer text is cut to the property's length. */
int hmi_unit_live_set_str(void *unit, int element, int setter, const char *value);
/** Takes live element `element` off the screen and frees it; -1 when it is unknown or still holds live elements. */
int hmi_unit_live_remove(void *unit, int element);
/** Frees every live element once the screen that held them is gone: another screen, or a new one, is in the slot. */
void hmi_unit_live_sync(void *unit);

#ifdef __cplusplus
}
#endif

#endif
