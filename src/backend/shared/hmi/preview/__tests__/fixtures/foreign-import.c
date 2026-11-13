/* A module importing from outside WASI, which the preview refuses. Built by tests/hmi-preview/build-fixture.mjs. */
__attribute__((import_module("env"), import_name("host_call"))) int host_call(void);
__attribute__((export_name("call"))) int call(void) { return host_call(); }
