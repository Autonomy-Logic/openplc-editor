/**
 * @file driver.cpp
 * Runs program.st against the HmiAlarms library headless: scripted alarm inputs and HMI acknowledgements, one block
 * of lines per step with the summary, the table rows and the log entries. Time is set per scan.
 */
#include <cstdint>
#include <cstdio>

#include "alarms_program.hpp"

namespace {

strucpp::Configuration_CONFIG g_config;
int64_t g_seconds = 1000;

/* One scan, one second after the last. */
void scan() {
    strucpp::__CURRENT_DT_NS = g_seconds * 1000000000LL;
    g_seconds += 1;
    g_config.INST.run();
}

void dump(const char *step) {
    const auto &s = g_config.INST.SYS;
    std::printf("%s count=%d active=%d unacked=%d top=%d acked=%d sev=%d '%s' lost4=%d logged=%d\n", step,
                (int)s.COUNT.get(), (int)s.ACTIVECOUNT.get(), (int)s.UNACKED.get(), (int)s.TOPVALID.get(),
                (int)s.TOPACKED.get(), (int)s.TOPSEVERITY.get(), s.TOPMESSAGE.get().c_str(), (int)strucpp::LOST4.get(),
                (int)strucpp::LOGGED.get());
    for (int i = 1; i <= 3; i++) {
        const auto &r = g_config.INST.ALARMS[i];
        std::printf("  row%d used=%d id=%d sev=%d active=%d acked=%d raised=%lld req=%d '%s'\n", i, (int)r.USED.get(),
                    (int)r.ID.get(), (int)r.SEVERITY.get(), (int)r.ACTIVE.get(), (int)r.ACKED.get(),
                    (long long)(r.RAISED.get() / 1000000000LL), (int)r.ACKREQ.get(), r.MESSAGE.get().c_str());
    }
    for (int i = 0; i <= 3; i++) {
        const auto &e = g_config.INST.EVENTS[i];
        std::printf("  log%d seq=%u kind=%d sev=%d at=%lld '%s'\n", i, (unsigned)e.SEQ.get(), (int)e.KIND.get(),
                    (int)e.SEVERITY.get(), (long long)(e.STAMP.get() / 1000000000LL), e.MESSAGE.get().c_str());
    }
}

}  // namespace

int main() {
    scan();
    dump("idle");

    /* Raise: the newest unacknowledged is the top. */
    strucpp::IN1.set(true);
    scan();
    strucpp::IN2.set(true);
    scan();
    dump("raise_two");

    /* Acknowledge one row: the other unacknowledged becomes the top. */
    strucpp::ACKROW.set(2);
    scan();
    dump("ack_row2");

    /* Clear an acknowledged alarm: its row is freed. A third alarm fills the table, a fourth is lost. */
    strucpp::IN2.set(false);
    strucpp::IN3.set(true);
    strucpp::IN4.set(true);
    scan();
    dump("clear2_raise3_4");

    /* Acknowledge the top, then clear the alarm behind it: the row stays until acknowledged. */
    strucpp::ACKTOPREQ.set(true);
    scan();
    dump("ack_top");
    strucpp::IN1.set(false);
    scan();
    dump("clear1");

    /* Acknowledge all: cleared rows are freed and the lost alarm takes a row. */
    strucpp::ACKALLREQ.set(true);
    scan();
    dump("ack_all");
    scan();
    dump("after_ack_all");

    /* A program event and a raise wrap the four-entry log. */
    strucpp::EV.set(true);
    scan();
    strucpp::EV.set(false);
    strucpp::IN2.set(true);
    scan();
    dump("log_wrapped");

    /* All clear and acknowledged: no top. */
    strucpp::IN2.set(false);
    strucpp::IN3.set(false);
    strucpp::IN4.set(false);
    strucpp::ACKALLREQ.set(true);
    scan();
    scan();
    dump("all_clear");
    return 0;
}
