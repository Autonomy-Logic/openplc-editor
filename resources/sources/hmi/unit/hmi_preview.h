/**
 * @file hmi_preview.h
 * @brief Live property setters of a generated HMI unit, for the editor's preview only; product hosts do not link them.
 *
 * The build numbers the literal properties of each screen's elements (see the setter table it returns). A preview
 * applies an edit of such a value without a new build: the next frame draws with it.
 */
#ifndef HMI_PREVIEW_H
#define HMI_PREVIEW_H

#ifdef __cplusplus
extern "C" {
#endif

/** Sets numeric or BOOL setter `setter` of screen `screen` (page number); returns 0, or -1 when there is none. */
int hmi_unit_set_num(void *unit, int screen, int setter, double value);
/** Sets STRING setter `setter` of screen `screen`; a longer text is cut to the property's length. */
int hmi_unit_set_str(void *unit, int screen, int setter, const char *value);

#ifdef __cplusplus
}
#endif

#endif
