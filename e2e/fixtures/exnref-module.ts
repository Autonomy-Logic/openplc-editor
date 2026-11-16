/**
 * A WebAssembly module that uses exception handling with exnref (try_table, catch_all_ref, throw_ref), the
 * encoding the simulator's Python runtime is built with. Its `run` export throws tag 0, catches it as an exnref,
 * rethrows it with throw_ref, catches it again by tag and returns 42. An engine without exnref rejects it.
 */
export const EXNREF_MODULE: number[] = [
  0, 97, 115, 109, 1, 0, 0, 0, 1, 13, 3, 96, 0, 1, 127, 96, 1, 127, 0, 96, 1, 105, 0, 3, 2, 1, 0, 13, 3, 1, 0, 1, 7, 7,
  1, 3, 114, 117, 110, 0, 0, 10, 33, 1, 31, 0, 2, 127, 2, 105, 31, 64, 1, 3, 0, 65, 1, 8, 0, 11, 0, 11, 31, 2, 1, 0, 0,
  0, 10, 11, 0, 11, 26, 65, 42, 11,
]
