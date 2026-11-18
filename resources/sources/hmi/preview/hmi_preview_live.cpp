/**
 * @file hmi_preview_live.cpp
 * @brief Live elements of the editor's preview (hmi_unit_live_* in hmi_preview.h): elements created from the factory
 *        table and placed in the shown screen exactly where its next build attaches them, so a new element is drawn
 *        before that build ends. Built with the generated unit; product hosts never link it.
 */
#include "hmi_preview.h"
#include "hmi_preview_factory.h"
#include "hmi_unit_libraries.hpp"

/** The screen built in the instance's slot, or null; generated with the unit (`hmi_preview.cpp`). */
hmi::HMISCREEN *hmi_preview_mounted_screen(void *unit);

namespace {

/** Live elements a screen may hold before a build replaces them. */
constexpr int kLiveMax = 64;
/** Capacities of the screen's drawing list, a stack's children and a diagram's parts (StandardWidgets). */
constexpr int kItemsMax = 256;
constexpr int kKidsMax = 64;
constexpr int kPartsMax = 256;

struct Live {
    int id;
    int type;
    void *element;
    /** The container's object, as screen code addresses it, and its ::hmi_live_container kind. */
    void *parent;
    int parent_kind;
};

Live g_live[kLiveMax];
int g_live_count;

/** An element of a pointer list, as STruC++ dereferences POINTER TO HmiElement. */
template <typename List>
int id_at(List &list, int i) {
    return list[i].get()->ELEMENTID().get();
}

/** Index of element `id` among the first `count` of `list`, or -1. */
template <typename List>
int index_of(List &list, int count, int id) {
    for (int i = 0; i < count; i++)
        if (id_at(list, i) == id) return i;
    return -1;
}

/** Inserts `element` at `at` of a pointer list holding `count`; false when it is full. */
template <typename List>
bool insert_at(List &list, int count, int capacity, int at, void *element) {
    if (count >= capacity) return false;
    for (int i = count; i > at; i--) list[i] = list[i - 1];
    list[at] = element;
    return true;
}

/** Removes entry `at` of a pointer list holding `count`. */
template <typename List>
void remove_at(List &list, int count, int at) {
    for (int i = at; i < count - 1; i++) list[i] = list[i + 1];
    list[count - 1] = nullptr;
}

/** Adds `element` to a container's children before child `before` (0: last); false when full or `before` is unknown. */
bool add_child(void *parent, int kind, void *element, int before) {
    if (kind == HMI_LIVE_STACK) {
        auto *stack = static_cast<hmi::HMISTACK *>(parent);
        const int n = stack->N.get();
        const int at = before > 0 ? index_of(stack->KIDS, n, before) : n;
        if (at < 0 || !insert_at(stack->KIDS, n, kKidsMax, at, element)) return false;
        stack->N.set(static_cast<int16_t>(n + 1));
        return true;
    }
    if (kind == HMI_LIVE_DIAGRAM) {
        auto *diagram = static_cast<hmi::HMIDIAGRAM *>(parent);
        const int n = diagram->NP.get();
        const int at = before > 0 ? index_of(diagram->PARTS, n, before) : n;
        if (at < 0 || !insert_at(diagram->PARTS, n, kPartsMax, at, element)) return false;
        diagram->NP.set(static_cast<int16_t>(n + 1));
        return true;
    }
    return false;
}

/** Takes element `id` out of a container's children. */
void remove_child(void *parent, int kind, int id) {
    if (kind == HMI_LIVE_STACK) {
        auto *stack = static_cast<hmi::HMISTACK *>(parent);
        const int n = stack->N.get();
        const int at = index_of(stack->KIDS, n, id);
        if (at < 0) return;
        remove_at(stack->KIDS, n, at);
        stack->N.set(static_cast<int16_t>(n - 1));
    } else if (kind == HMI_LIVE_DIAGRAM) {
        auto *diagram = static_cast<hmi::HMIDIAGRAM *>(parent);
        const int n = diagram->NP.get();
        const int at = index_of(diagram->PARTS, n, id);
        if (at < 0) return;
        remove_at(diagram->PARTS, n, at);
        diagram->NP.set(static_cast<int16_t>(n - 1));
    }
}

int live_index(int id) {
    for (int i = 0; i < g_live_count; i++)
        if (g_live[i].id == id) return i;
    return -1;
}

}  // namespace

extern "C" {

int hmi_unit_live_add(void *unit, int type, int parent, int parent_kind, int before, int draw_before) {
    hmi::HMISCREEN *screen = hmi_preview_mounted_screen(unit);
    if (!screen || g_live_count >= kLiveMax) return -1;
    const int count = screen->COUNT.get();
    if (count >= kItemsMax) return -1;
    void *container = nullptr;
    if (parent == 0) {
        if (parent_kind != HMI_LIVE_STACK) return -1;
        container = &screen->ROOT;
    } else {
        const int at = index_of(screen->ITEMS, count, parent);
        if (at < 0) return -1;
        container = screen->ITEMS[at].get_void();
    }
    const int slot = draw_before > 0 ? index_of(screen->ITEMS, count, draw_before) : count;
    if (slot < 0) return -1;
    void *element = hmi_factory_create(type);
    if (!element) return -1;
    if (!add_child(container, parent_kind, element, before)) {
        hmi_factory_destroy(type, element);
        return -1;
    }
    insert_at(screen->ITEMS, count, kItemsMax, slot, element);
    screen->COUNT.set(static_cast<int16_t>(count + 1));
    const int id = screen->NEXTID.get();
    static_cast<hmi::HMIELEMENT *>(element)->SETID(id);
    screen->NEXTID.set(id + 1);
    g_live[g_live_count++] = Live{id, type, element, container, parent_kind};
    return id;
}

int hmi_unit_live_set_num(void *unit, int element, int setter, double value) {
    const int i = live_index(element);
    if (!hmi_preview_mounted_screen(unit) || i < 0) return -1;
    return hmi_factory_set_num(g_live[i].type, g_live[i].element, setter, value);
}

int hmi_unit_live_set_str(void *unit, int element, int setter, const char *value) {
    const int i = live_index(element);
    if (!hmi_preview_mounted_screen(unit) || i < 0 || !value) return -1;
    return hmi_factory_set_str(g_live[i].type, g_live[i].element, setter, value);
}

int hmi_unit_live_remove(void *unit, int element) {
    hmi::HMISCREEN *screen = hmi_preview_mounted_screen(unit);
    const int i = live_index(element);
    if (!screen || i < 0) return -1;
    for (int k = 0; k < g_live_count; k++)
        if (g_live[k].parent == g_live[i].element) return -1;
    const int count = screen->COUNT.get();
    const int at = index_of(screen->ITEMS, count, element);
    if (at >= 0) {
        remove_at(screen->ITEMS, count, at);
        screen->COUNT.set(static_cast<int16_t>(count - 1));
    }
    remove_child(g_live[i].parent, g_live[i].parent_kind, element);
    hmi_factory_destroy(g_live[i].type, g_live[i].element);
    g_live[i] = g_live[--g_live_count];
    return 0;
}

void hmi_unit_live_sync(void *unit) {
    if (g_live_count == 0) return;
    hmi::HMISCREEN *screen = hmi_preview_mounted_screen(unit);
    const int at = screen ? index_of(screen->ITEMS, screen->COUNT.get(), g_live[0].id) : -1;
    if (at >= 0 && screen->ITEMS[at].get_void() == g_live[0].element) return;
    for (int i = 0; i < g_live_count; i++) hmi_factory_destroy(g_live[i].type, g_live[i].element);
    g_live_count = 0;
}

}  // extern "C"
