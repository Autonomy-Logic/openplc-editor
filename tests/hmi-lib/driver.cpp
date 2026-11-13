/**
 * @file driver.cpp
 * Runs the test screens of screens.st headless: scripted pointer and key input, one line per frame with the page,
 * the display list hash, the frame status and the wired variables. Frames marked for dumping are also rasterized;
 * their pixel hash is printed and, with a directory argument, their RGBA is written there.
 * Usage: driver [dump-dir]
 */
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <vector>

#include "hmi_core.h"
#include "hmi_unit.hpp"

namespace {

constexpr int32_t kW = 480;
constexpr int32_t kH = 320;

strucpp::Configuration_HMICONFIG g_config;
uint32_t g_now;
const char *g_dump_dir;

/* Element ids follow the order of Attach calls, across screens. */
enum : int32_t {
    kStart = 15, kRunSwitch, kSpeedSlider, kSetpointIn, kNameIn, kLocked,
    kPlant = 21, kPump = 26, kValve = 27,
    kBack = 35, kHome = 36,
};

uint64_t fnv(const uint8_t *p, size_t n) {
    uint64_t h = 1469598103934665603ull;
    for (size_t i = 0; i < n; i++) h = (h ^ p[i]) * 1099511628211ull;
    return h;
}

void frame(const char *label, bool dump = false) {
    hmi_set_time_ms(g_now);
    g_now += 40;
    hmi_frame_begin();
    g_config.HMIINST.run();
    size_t len = 0;
    const uint8_t *dl = hmi_frame_end(&len);
    std::printf("%s page=%d dl=%016llx status=%u run=%d held=%d clicks=%d pump=%d valve=%d speed=%.2f setpoint=%.3f "
                "name='%s' shows=%d hides=%d",
                label, (int)hmi_page(), (unsigned long long)hmi_frame_hash(), (unsigned)hmi_frame_status(),
                (int)strucpp::RUN.get(), (int)strucpp::HELD.get(), (int)strucpp::CLICKS.get(),
                (int)strucpp::PUMPON.get(), (int)strucpp::VALVEOPEN.get(), (double)strucpp::SPEED.get(),
                (double)strucpp::SETPOINT.get(), strucpp::NAME.get().c_str(), (int)strucpp::SHOWS.get(),
                (int)strucpp::HIDES.get());
    if (dump) {
        std::vector<uint8_t> px((size_t)kW * kH * 4);
        int rc = hmi_raster_render(dl, len, px.data(), kW, kH, kW, 0, kH, 256, 0, 0);
        std::printf(" raster=%d px=%016llx", rc, (unsigned long long)fnv(px.data(), px.size()));
        if (g_dump_dir) {
            std::string path = std::string(g_dump_dir) + "/" + label + ".rgba";
            FILE *f = std::fopen(path.c_str(), "wb");
            if (f) {
                int32_t wh[2] = {kW, kH};
                std::fwrite(wh, sizeof wh, 1, f);
                std::fwrite(px.data(), 1, px.size(), f);
                std::fclose(f);
            }
        }
    }
    std::printf("\n");
}

/* Centre of an element in lu, from the last frame's bounds; exits when the element was not drawn. */
void centre_of(int32_t id, int32_t *x, int32_t *y) {
    const int32_t *b = hmi_bounds_data();
    for (int i = 0; i < hmi_bounds_count(); i++, b += 5) {
        if (b[0] != id) continue;
        *x = (b[1] + b[3] / 2) / 16;
        *y = (b[2] + b[4] / 2) / 16;
        return;
    }
    std::printf("element %d not drawn\n", (int)id);
    std::exit(1);
}

void press(int32_t x, int32_t y) { hmi_input_pointer(HMI_PTR_DOWN, x * 16, y * 16); }
void move(int32_t x, int32_t y) { hmi_input_pointer(HMI_PTR_MOVE, x * 16, y * 16); }
void release(int32_t x, int32_t y) { hmi_input_pointer(HMI_PTR_UP, x * 16, y * 16); }

/* Press in one frame, release in the next. */
void tap_at(const char *label, int32_t x, int32_t y) {
    std::string down = std::string(label) + "_down", up = std::string(label) + "_up";
    press(x, y);
    frame(down.c_str());
    release(x, y);
    frame(up.c_str());
}

void tap(const char *label, int32_t id) {
    int32_t x, y;
    centre_of(id, &x, &y);
    tap_at(label, x, y);
}

void keys(const char *text) {
    for (const char *c = text; *c; c++) hmi_input_key((uint32_t)(unsigned char)*c);
}

void show(int32_t page) { hmi_set_page(page); }

}  // namespace

int main(int argc, char **argv) {
    g_dump_dir = argc > 1 ? argv[1] : nullptr;
    hmi_core_init(kW, kH);

    /* Display widgets, the start screen. */
    strucpp::SPEED.set(123.4f);
    strucpp::LEVEL.set(6.25f);
    strucpp::FLOW.set(88.5f);
    frame("display_0");
    frame("display", true);

    /* Trend and vessel, values changing over time. */
    show(1);
    for (int i = 0; i < 24; i++) {
        strucpp::LEVEL.set(2.0f + (float)(i % 12) * 0.5f);
        strucpp::FLOW.set(60.0f + (float)i * 2.0f);
        frame(i == 23 ? "trend" : "trend_step", i == 23);
    }

    /* Controls: momentary button, switch, slider drag, numeric and text entry, a disabled switch. */
    show(2);
    frame("controls_0");
    frame("controls", true);
    tap("button", kStart);
    tap("switch", kRunSwitch);
    {
        int32_t x, y;
        centre_of(kSpeedSlider, &x, &y);
        press(x - 60, y);
        frame("slider_down");
        move(x + 40, y);
        frame("slider_move", true);
        release(x + 40, y);
        frame("slider_up");
    }
    tap("setpoint", kSetpointIn);
    frame("keyboard_numeric", true);
    keys("\b\b\b\b\b42.5\r");
    frame("setpoint_typed");
    tap("setpoint_again", kSetpointIn);
    /* Numeric keyboard at 480 x 320: key '7' at (125, 108), OK at (353, 270). */
    tap_at("key_7", 125, 108);
    tap_at("key_ok", 353, 270);
    tap("name", kNameIn);
    frame("keyboard_text", true);
    keys("\b\b\b\b\b\bPUMP STATION 7\r");
    frame("name_typed");
    tap("locked", kLocked);
    frame("controls_after", true);

    /* Diagram: pump and valve taps, pipe animation, panning a drawing larger than its room. */
    show(3);
    frame("diagram_0");
    frame("diagram", true);
    tap("pump", kPump);
    tap("valve", kValve);
    frame("diagram_flowing", true);
    {
        int32_t x, y;
        centre_of(kPlant, &x, &y);
        press(x, y + 60);
        frame("pan_down");
        move(x - 120, y);
        frame("pan_move");
        release(x - 120, y);
        frame("pan_up", true);
    }

    /* Layout within limits, floating element. */
    show(4);
    frame("layout_0");
    frame("layout", true);
    std::printf("layout w1=%d w2=%d w3=%d x4=%d\n", (int)strucpp::LAYOUTW1.get(), (int)strucpp::LAYOUTW2.get(),
                (int)strucpp::LAYOUTW3.get(), (int)strucpp::LAYOUTX4.get());

    /* Navigation: show and hide hooks, back, home. */
    show(5);
    frame("nav_0");
    frame("nav");
    tap("back", kBack);
    frame("after_back");
    show(5);
    frame("nav_again");
    tap("home", kHome);
    frame("after_home");

    /* A second viewer starts on the start page with its own state. */
    hmi_session_t *viewer = hmi_session_create();
    hmi_session_use(viewer);
    hmi_core_init(320, 240);
    frame("viewer2", true);
    hmi_session_use(nullptr);
    hmi_session_destroy(viewer);
    frame("viewer1_after");
    return 0;
}
