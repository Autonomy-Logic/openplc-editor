/*
opcua_arch.cpp - the platform layer open62541 expects, for bare metal
Copyright (C) 2026 Autonomy Logic

open62541 is built here with UA_ARCHITECTURE=none: its core is
OS-independent and everything platform-specific sits behind plugin structs.
Phase 0 (DOPE-626) established that the entire surface is SIX symbols, found
by linking a server-shaped stub against the archive:

    UA_DateTime_now                     UA_EventLoop_new_POSIX
    UA_DateTime_localTimeUtcOffset      UA_ConnectionManager_new_POSIX_TCP
    UA_InterruptManager_new_POSIX       UA_ConnectionManager_new_POSIX_UDP

They carry _POSIX names even under UA_ARCHITECTURE=none because the
server_config_default plugin references those factories unconditionally. Two
ways out: rename our implementations to match, or stop using
UA_ServerConfig_setMinimal and assemble the config by hand. We take the first,
because the second means duplicating a few hundred lines of upstream config
setup that would then need re-checking on every version bump — but the
implementations below are named *_Arduino, and the _POSIX symbols at the bottom
are one-line forwarders. A symbol name that lies about the platform is worth
containing to three lines rather than spreading through the file.
*/

#include "opcua_config.h"

#if OPCUA_ENABLED

#include <Arduino.h>

// Umbrella, not the nested paths: arduino-cli resolves a library by
// basename at src/ root, so <open62541/...> discovers nothing and the
// precompiled archive silently misses the link. See the header itself.
#include <open62541.h>

#include "opcua_arch.h"
#include "opcua_log.h"
#include "opcua_net.h"

// ---------------------------------------------------------------------------
// Clock
//
// OPC-UA stamps every value with a DateTime: 100 ns ticks since 1601-01-01.
// The LOGO! has no RTC in use (docs/firmware-map.md), so wall-clock time is
// a build-time epoch plus uptime. That makes timestamps wrong by the device's
// accumulated downtime rather than wrong by 24 years, which is the difference
// between a client showing a stale date and a client rejecting the response.
// OPCUA_HAS_RTC gates anything that needs better (certificate validity).
// ---------------------------------------------------------------------------

/** 100 ns ticks between 1601-01-01 and the Unix epoch. */
static const UA_DateTime kUnixEpochOffset = UA_DATETIME_UNIX_EPOCH;

/** Monotonic microseconds, immune to the 32-bit micros() wrap.
 *
 *  micros() rolls over every ~71 minutes. A PLC runs for months, and OPC-UA
 *  timers derive their deadlines from this, so a wrap that read as a jump
 *  backwards would stall every repeated callback for another 71 minutes.
 *  Called from the scan loop far more often than the wrap period, so
 *  observing the low word going backwards is a reliable wrap detector. */
static uint64_t monotonic_micros()
{
    static uint32_t last = 0;
    static uint64_t high = 0;
    const uint32_t now = micros();
    if (now < last)
        high += (uint64_t)1 << 32;
    last = now;
    return high + now;
}

extern "C" UA_DateTime UA_DateTime_now(void)
{
    return kUnixEpochOffset + (UA_DateTime)OPCUA_BUILD_EPOCH * UA_DATETIME_SEC
           + (UA_DateTime)(monotonic_micros() * 10);
}

extern "C" UA_DateTime UA_DateTime_nowMonotonic(void)
{
    return (UA_DateTime)(monotonic_micros() * 10);
}

extern "C" UA_Int64 UA_DateTime_localTimeUtcOffset(void)
{
    // No timezone database and no RTC to apply one to. Reporting UTC and
    // saying so beats inventing an offset.
    return 0;
}

namespace {

// ---------------------------------------------------------------------------
// Timers
//
// open62541's own timer implementation (arch/common/timer.c) is internal and
// not installed with the public headers, so the EventLoop needs its own. A
// fixed-size array rather than a list: the server registers a small, bounded
// set of repeated callbacks (channel/session housekeeping), and a static array
// keeps the allocation out of the arena and the worst case bounded.
// ---------------------------------------------------------------------------

// open62541 registers several repeated callbacks of its own (SecureChannel
// housekeeping, session timeouts, discovery upkeep) and more arrive as
// features are enabled. A table too small is not a soft limit: addTimer
// returns BADOUTOFMEMORY, the server carries on believing the callback is
// scheduled, and the work silently never happens. SecureChannel housekeeping
// is exactly the one that must not be dropped — without it closed channels
// are never reaped and, with maxSecureChannels small, the next client is
// refused.
constexpr uint8_t kMaxTimers = 24;

struct Timer
{
    UA_UInt64      id;
    UA_Callback    cb;
    void*          application;
    void*          data;
    UA_DateTime    interval;   // 100 ns ticks
    UA_DateTime    next;
    UA_TimerPolicy policy;
    bool           active;
};

struct ArduinoEventLoop
{
    UA_EventLoop        base;      // MUST be first: open62541 casts between them
    Timer               timers[kMaxTimers];
    UA_UInt64           next_id;
    UA_DelayedCallback* delayed;
};

ArduinoEventLoop* self(UA_EventLoop* el) { return reinterpret_cast<ArduinoEventLoop*>(el); }

/** The state member is `const volatile` so open62541 callers cannot write it;
 *  the owner still has to. */
void set_state(UA_EventLoop* el, UA_EventLoopState s)
{
    *const_cast<UA_EventLoopState*>(&el->state) = s;
}

UA_StatusCode el_start(UA_EventLoop* el)
{
    set_state(el, UA_EVENTLOOPSTATE_STARTED);
    for (UA_EventSource* es = el->eventSources; es != nullptr; es = es->next)
    {
        if (es->state == UA_EVENTSOURCESTATE_STOPPED && es->start != nullptr)
            es->start(es);
    }
    return UA_STATUSCODE_GOOD;
}

void el_stop(UA_EventLoop* el)
{
    for (UA_EventSource* es = el->eventSources; es != nullptr; es = es->next)
    {
        if (es->stop != nullptr)
            es->stop(es);
    }
    set_state(el, UA_EVENTLOOPSTATE_STOPPED);
}

UA_StatusCode el_free(UA_EventLoop* el)
{
    if (el->state != UA_EVENTLOOPSTATE_STOPPED)
        return UA_STATUSCODE_BADINTERNALERROR;
    for (UA_EventSource* es = el->eventSources; es != nullptr;)
    {
        UA_EventSource* next = es->next;
        if (es->free != nullptr)
            es->free(es);
        es = next;
    }
    UA_free(el);
    return UA_STATUSCODE_GOOD;
}

void run_due_timers(ArduinoEventLoop* l)
{
    const UA_DateTime now = UA_DateTime_nowMonotonic();
    for (uint8_t i = 0; i < kMaxTimers; i++)
    {
        Timer& t = l->timers[i];
        if (!t.active || t.next > now)
            continue;
        // One-shot vs repeated is the POLICY, not a zero interval — see
        // UA_TimerPolicy. Getting this wrong would either re-arm a callback
        // open62541 expects to fire once, or silently drop a repeated one.
        if (t.policy == UA_TIMERPOLICY_ONCE)
            t.active = false;
        else if (t.policy == UA_TIMERPOLICY_CURRENTTIME)
            t.next = now + t.interval;   // re-phase from now, dropping misses
        else
            t.next += t.interval;        // BASETIME: keep the original phase
        if (t.cb != nullptr)
            t.cb(t.application, t.data);
    }
}

void drain_delayed(ArduinoEventLoop* l)
{
    // Taken as a whole list first: a delayed callback is allowed to enqueue
    // another, and servicing that in the same pass could loop without bound
    // inside a scan cycle.
    UA_DelayedCallback* dc = l->delayed;
    l->delayed = nullptr;
    while (dc != nullptr)
    {
        UA_DelayedCallback* next = dc->next;
        if (dc->callback != nullptr)
            dc->callback(dc->application, dc->context);
        dc = next;
    }
}

/** Non-blocking, always — `timeout` is ignored.
 *
 *  This is called from opcuatask() inside a cooperative scan loop, where the
 *  scan cycle is the contract with the user's program. Honouring a timeout
 *  would mean sleeping with the PLC logic stopped. Pending work is picked up
 *  next scan; request/response over TCP tolerates that, a wandering cycle
 *  time does not. */
UA_StatusCode el_run(UA_EventLoop* el, UA_UInt32 timeout)
{
    (void)timeout;
    if (el->state != UA_EVENTLOOPSTATE_STARTED)
        return UA_STATUSCODE_BADINTERNALERROR;
    ArduinoEventLoop* l = self(el);
    opcua_net::poll();
    run_due_timers(l);
    for (UA_EventSource* es = el->eventSources; es != nullptr; es = es->next)
    {
        if (es->eventSourceType == UA_EVENTSOURCETYPE_CONNECTIONMANAGER)
        {
            UA_ConnectionManager* cm = reinterpret_cast<UA_ConnectionManager*>(es);
            if (cm->eventSource.state == UA_EVENTSOURCESTATE_STARTED)
                opcua_cm_poll(cm);
        }
    }
    drain_delayed(l);
    return UA_STATUSCODE_GOOD;
}

void el_cancel(UA_EventLoop* el) { (void)el; }

UA_DateTime el_now(UA_EventLoop* el)          { (void)el; return UA_DateTime_now(); }
UA_DateTime el_now_monotonic(UA_EventLoop* el) { (void)el; return UA_DateTime_nowMonotonic(); }
UA_Int64    el_utc_offset(UA_EventLoop* el)    { (void)el; return 0; }

UA_DateTime el_next_timer(UA_EventLoop* el)
{
    ArduinoEventLoop* l = self(el);
    UA_DateTime soonest = UA_INT64_MAX;
    for (uint8_t i = 0; i < kMaxTimers; i++)
    {
        if (l->timers[i].active && l->timers[i].next < soonest)
            soonest = l->timers[i].next;
    }
    return soonest;
}

UA_StatusCode el_add_timer(UA_EventLoop* el, UA_Callback cb, void* application, void* data,
                           UA_Double interval_ms, UA_DateTime* baseTime,
                           UA_TimerPolicy policy, UA_UInt64* timerId)
{
    ArduinoEventLoop* l = self(el);
    for (uint8_t i = 0; i < kMaxTimers; i++)
    {
        Timer& t = l->timers[i];
        if (t.active)
            continue;
        t.id          = ++l->next_id;
        t.cb          = cb;
        t.application = application;
        t.data        = data;
        t.interval    = (UA_DateTime)(interval_ms * (UA_Double)UA_DATETIME_MSEC);
        t.policy      = policy;
        t.next        = (baseTime != nullptr ? *baseTime : UA_DateTime_nowMonotonic()) + t.interval;
        t.active      = true;
        if (timerId != nullptr)
            *timerId = t.id;
        return UA_STATUSCODE_GOOD;
    }
    // Bounded by design; refusing loudly beats silently not running a callback
    // the server believes is scheduled.
    OPCUA_LOG("[el] addTimer REFUSED - timer table full (%u)", (unsigned)kMaxTimers);
    return UA_STATUSCODE_BADOUTOFMEMORY;
}

UA_StatusCode el_modify_timer(UA_EventLoop* el, UA_UInt64 timerId, UA_Double interval_ms,
                              UA_DateTime* baseTime, UA_TimerPolicy policy)
{
    ArduinoEventLoop* l = self(el);
    for (uint8_t i = 0; i < kMaxTimers; i++)
    {
        Timer& t = l->timers[i];
        if (!t.active || t.id != timerId)
            continue;
        t.interval = (UA_DateTime)(interval_ms * (UA_Double)UA_DATETIME_MSEC);
        t.policy   = policy;
        t.next     = (baseTime != nullptr ? *baseTime : UA_DateTime_nowMonotonic()) + t.interval;
        return UA_STATUSCODE_GOOD;
    }
    return UA_STATUSCODE_BADNOTFOUND;
}

void el_remove_timer(UA_EventLoop* el, UA_UInt64 timerId)
{
    ArduinoEventLoop* l = self(el);
    for (uint8_t i = 0; i < kMaxTimers; i++)
    {
        if (l->timers[i].active && l->timers[i].id == timerId)
            l->timers[i].active = false;
    }
}

void el_add_delayed(UA_EventLoop* el, UA_DelayedCallback* dc)
{
    if (dc == nullptr)
        return;
    ArduinoEventLoop* l = self(el);
    dc->next = l->delayed;
    l->delayed = dc;
}

void el_remove_delayed(UA_EventLoop* el, UA_DelayedCallback* dc)
{
    ArduinoEventLoop* l = self(el);
    UA_DelayedCallback** pp = &l->delayed;
    while (*pp != nullptr)
    {
        if (*pp == dc) { *pp = dc->next; return; }
        pp = &(*pp)->next;
    }
}

UA_StatusCode el_register_es(UA_EventLoop* el, UA_EventSource* es)
{
    if (es == nullptr)
        return UA_STATUSCODE_BADINVALIDARGUMENT;
    es->eventLoop = el;
    es->next = el->eventSources;
    el->eventSources = es;
    if (el->state == UA_EVENTLOOPSTATE_STARTED && es->start != nullptr)
        return es->start(es);
    return UA_STATUSCODE_GOOD;
}

UA_StatusCode el_deregister_es(UA_EventLoop* el, UA_EventSource* es)
{
    UA_EventSource** pp = &el->eventSources;
    while (*pp != nullptr)
    {
        if (*pp == es) { *pp = es->next; es->next = nullptr; return UA_STATUSCODE_GOOD; }
        pp = &(*pp)->next;
    }
    return UA_STATUSCODE_BADNOTFOUND;
}

// Single-threaded by construction (UA_MULTITHREADING=0) and driven from one
// cooperative scan loop, so there is nothing to serialise against.
void el_lock(UA_EventLoop* el)   { (void)el; }
void el_unlock(UA_EventLoop* el) { (void)el; }

} // namespace

UA_EventLoop* UA_EventLoop_new_Arduino(const UA_Logger* logger)
{
    ArduinoEventLoop* l = static_cast<ArduinoEventLoop*>(UA_calloc(1, sizeof(ArduinoEventLoop)));
    if (l == nullptr)
        return nullptr;

    UA_EventLoop* el = &l->base;
    el->logger = logger;
    set_state(el, UA_EVENTLOOPSTATE_FRESH);

    el->start                   = el_start;
    el->stop                    = el_stop;
    el->free                    = el_free;
    el->run                     = el_run;
    el->cancel                  = el_cancel;
    el->dateTime_now            = el_now;
    el->dateTime_nowMonotonic   = el_now_monotonic;
    el->dateTime_localTimeUtcOffset = el_utc_offset;
    el->nextTimer               = el_next_timer;
    el->addTimer                = el_add_timer;
    el->modifyTimer             = el_modify_timer;
    el->removeTimer             = el_remove_timer;
    el->addDelayedCallback      = el_add_delayed;
    el->removeDelayedCallback   = el_remove_delayed;
    el->registerEventSource     = el_register_es;
    el->deregisterEventSource   = el_deregister_es;
    el->lock                    = el_lock;
    el->unlock                  = el_unlock;
    return el;
}

/** Bare-metal abort().
 *
 *  newlib-nano under the core's -nostdlib does not provide one, and libgcc's
 *  ARM unwinder references it. The archive is built -fno-unwind-tables so the
 *  unwinder should not be reachable at all, but this stays as a safety net:
 *  the alternative to defining it is a link failure that points at libgcc
 *  rather than at anything a reader wrote.
 *
 *  Weak, so a core or application that supplies a real one wins.
 *
 *  Behaviour is deliberate rather than a stub: a library calling abort() on a
 *  PLC is an unrecoverable internal fault, and the honest response is to stop
 *  touching the outputs and let the watchdog reset the device — which is the
 *  recovery path the runtime already relies on. Spinning with interrupts off
 *  is what makes the WDT fire. */
extern "C" __attribute__((weak, noreturn)) void abort(void)
{
    noInterrupts();
    for (;;) { }
}

// ---------------------------------------------------------------------------
// The _POSIX names server_config_default insists on. See the file header.
// ---------------------------------------------------------------------------

extern "C" UA_EventLoop* UA_EventLoop_new_POSIX(const UA_Logger* logger)
{
    return UA_EventLoop_new_Arduino(logger);
}

extern "C" UA_ConnectionManager* UA_ConnectionManager_new_POSIX_TCP(const UA_String eventSourceName)
{
    return UA_ConnectionManager_new_Arduino_TCP(eventSourceName);
}

extern "C" UA_ConnectionManager* UA_ConnectionManager_new_POSIX_UDP(const UA_String eventSourceName)
{
    // No UDP transport. OPC-UA's mandatory profile is UA-TCP; UDP is only used
    // by PubSub and multicast discovery, both compiled out of this build.
    // Returning null is honest — a config that asks for UDP fails at setup
    // rather than at first datagram.
    (void)eventSourceName;
    return nullptr;
}

extern "C" UA_InterruptManager* UA_InterruptManager_new_POSIX(const UA_String eventSourceName)
{
    // Only PubSub's realtime paths register interrupts, and PubSub is off.
    (void)eventSourceName;
    return nullptr;
}

#endif // OPCUA_ENABLED
