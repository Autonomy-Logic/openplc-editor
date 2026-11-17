/**
 * What a Python function block's generated stub calls, for the simulator (force-included like the runtime's own
 * iec_python.h). The two buffers live in module memory; the host runs the script and exchanges them.
 */
#pragma once

#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/types.h>

/* WASI has no process ids; the rename keeps clear of the libc declaration. */
#define getpid openplc_sim_getpid

#ifdef __cplusplus
extern "C" {
#endif

pid_t openplc_sim_getpid(void);

/** A name unique to each block instance in this run. */
void create_shm_name(char *name, size_t size);

/**
 * Allocates the block's input and output buffers and asks the host to start its script. Returns 0, or -1 when the
 * buffers cannot be allocated or the host refuses.
 */
int python_block_loader(const char *script_name, const char *script_content, const char *shm_name, size_t shm_in_size,
                        size_t shm_out_size, void **shm_in_ptr, void **shm_out_ptr, pid_t pid);

#ifdef __cplusplus
}
#endif
