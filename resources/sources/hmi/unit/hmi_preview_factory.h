/**
 * @file hmi_preview_factory.h
 * @brief The widget types a preview unit creates at run time: a table the HMI build generates with the unit
 *        (`hmi_preview_factory.cpp`), numbered as the build's factory description says. Preview only.
 */
#ifndef HMI_PREVIEW_FACTORY_H
#define HMI_PREVIEW_FACTORY_H

/** A new element of widget type `type` with its declared defaults, or null for an unknown type or short memory. */
void *hmi_factory_create(int type);
/** Frees an element hmi_factory_create made for `type`. */
void hmi_factory_destroy(int type, void *element);
/** Sets numeric or BOOL setter `setter` of an element of type `type`; 0, or -1 when the type has no such setter. */
int hmi_factory_set_num(int type, void *element, int setter, double value);
/** Sets STRING setter `setter` of an element of type `type`; 0, or -1 when the type has no such setter. */
int hmi_factory_set_str(int type, void *element, int setter, const char *value);

#endif
