// Test worker that fails while loading, as a missing or broken toolchain would.
throw new Error('toolchain failed to load')
