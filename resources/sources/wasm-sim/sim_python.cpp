/**
 * Python function blocks in the simulator.
 *
 * Import, module "env":
 *   host_python_block(name, name_length, script, script_length, in, in_size, out, out_size)
 *       starts the block's script; the host reads `in` and writes `out` between scans. Returns 0, or -1 to refuse.
 */
#include <stdlib.h>

#include "iec_python.h"

extern "C" {
__attribute__((import_module("env"), import_name("host_python_block"))) int32_t host_python_block(
    const char *name, uint32_t name_length, const char *script, uint32_t script_length, void *in, uint32_t in_size,
    void *out, uint32_t out_size);
}

namespace {

unsigned block_count = 0;

/** The script name without its `.py` extension. */
size_t block_name_length(const char *script_name)
{
    size_t length = strlen(script_name);
    if (length > 3 && strcmp(script_name + length - 3, ".py") == 0) return length - 3;
    return length;
}

} // namespace

extern "C" {

pid_t openplc_sim_getpid(void) { return 1; }

void create_shm_name(char *name, size_t size)
{
    snprintf(name, size, "openplc_sim_block_%u", ++block_count);
}

int python_block_loader(const char *script_name, const char *script_content, const char *, size_t shm_in_size,
                        size_t shm_out_size, void **shm_in_ptr, void **shm_out_ptr, pid_t)
{
    void *in = calloc(1, shm_in_size > 0 ? shm_in_size : 1);
    void *out = calloc(1, shm_out_size > 0 ? shm_out_size : 1);
    if (in == NULL || out == NULL) {
        free(in);
        free(out);
        return -1;
    }
    int32_t accepted = host_python_block(script_name, (uint32_t)block_name_length(script_name), script_content,
                                         (uint32_t)strlen(script_content), in, (uint32_t)shm_in_size, out,
                                         (uint32_t)shm_out_size);
    if (accepted < 0) {
        free(in);
        free(out);
        return -1;
    }
    *shm_in_ptr = in;
    *shm_out_ptr = out;
    return 0;
}

} // extern "C"
