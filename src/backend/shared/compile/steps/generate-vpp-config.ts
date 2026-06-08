/**
 * Author the `vpp_config.h` content for an arduino-cli build target
 * whose VPP package declares `vppIo: true`.
 *
 * The Arduino driver pipeline can't load a runtime JSON the way the
 * Linux-based VPP plugins do (SLM-RP4 ships a JSON file alongside the
 * compiled binary; the plugin loads it via `dlopen` + libjson). On
 * microcontroller targets every byte of configuration has to be baked
 * into flash at compile time. `vpp_config.h` is the contract: a single
 * generated header file the HAL driver `#include`s to recover every
 * value the user set on the device's configuration screens.
 *
 * Shape:
 *
 *   - One `#define` per leaf value in `vendorScreenData`.
 *   - Naming convention: `VPP_<SCREEN_KEY>_<PATH...>`, all uppercase,
 *     underscores separating path segments. The screen key is the
 *     `persistence` (or `id`) the screen section declared; the path
 *     segments come from walking nested objects/arrays.
 *   - Scalars (string / number / boolean) become bare literals. Strings
 *     are quoted; booleans are `0` / `1`. `null` and `undefined` leaves
 *     are skipped (the driver should treat the absence of a define as
 *     "use default").
 *   - Arrays of scalars become brace-initializers
 *     (`#define VPP_FOO_BAR { 1, 2, 3 }`) so the driver can declare
 *     a typed array: `const uint8_t bar[] = VPP_FOO_BAR;`. Plus a
 *     companion `<PATH>_COUNT` define carries the length.
 *   - Arrays of objects become per-index defines + `<PATH>_COUNT`:
 *     `VPP_BACKPLANE_SLOTS_0_MODULE_ID`, etc.
 *
 * Pure function: no fs I/O, no DOM, no global state. Caller writes
 * the returned string to `src/vpp_config.h` in the firmware bundle
 * (next to `defines.h`). Mirrors the style of `generate-defines.ts`.
 */

export interface GenerateVppConfigInput {
  /** `DeviceConfiguration.vendorScreenData` from the project model.
   *  Top-level keys are persistence keys (one per screen section).
   *  Values are arbitrary JSON authored by the layout components.
   *  Absent / undefined emits a minimal stub header so the driver's
   *  `#include` still resolves. */
  vendorScreenData: Record<string, unknown> | undefined
}

/**
 * Build the contents of `vpp_config.h`.
 *
 * Always emits the include-guard header. Always emits a trailing
 * `#endif`. Body content depends entirely on what's in
 * `vendorScreenData` — every leaf walked through `walk()` becomes
 * one `#define`.
 */
export function generateVppConfigContent(input: GenerateVppConfigInput): string {
  const { vendorScreenData } = input

  const lines: string[] = []
  lines.push('// vpp_config.h — auto-generated, do not edit by hand.')
  lines.push('//')
  lines.push('// Carries the user-authored configuration-screen data for this')
  lines.push('// build target as C preprocessor #defines. The HAL driver')
  lines.push('// `#include`s this file and reads whatever subset it needs;')
  lines.push('// unused defines are harmless.')
  lines.push('')
  lines.push('#ifndef VPP_CONFIG_H')
  lines.push('#define VPP_CONFIG_H')
  lines.push('')

  if (vendorScreenData) {
    // Sort top-level keys so the output is deterministic across runs
    // — same input bytes produce the same output bytes, important for
    // the editor's "compile didn't change" cache and for cross-repo
    // byte-diff hygiene.
    const keys = Object.keys(vendorScreenData).sort()
    for (const key of keys) {
      const prefix = `VPP_${sanitize(key, true)}`
      walk(vendorScreenData[key], prefix, lines)
    }
    if (lines[lines.length - 1] !== '') lines.push('')
  }

  lines.push('#endif // VPP_CONFIG_H')
  lines.push('')
  return lines.join('\n')
}

/**
 * Normalise a path segment for inclusion in a C identifier.  Non-
 * alphanumeric characters become `_`; identifiers are upper-cased.
 *
 * `topLevel` controls leading-digit handling. C identifiers can't
 * start with a digit, so a screen key like `"4g-network"` must
 * become `_4G_NETWORK` at the macro head. Nested keys (e.g.
 * `slotsConfig["1"]`) are concatenated AFTER an already-valid
 * parent path (`VPP_MODULE_CONFIGURATION_SLOTSCONFIG_`), so the
 * digit isn't at the head of the macro and no extra `_` is needed.
 * Adding one anyway would produce ugly double underscores like
 * `SLOTSCONFIG__1_…`.
 */
function sanitize(s: string, topLevel: boolean): string {
  const out = s.replace(/[^A-Za-z0-9_]/g, '_').toUpperCase()
  if (topLevel && out.length > 0 && /^[0-9]/.test(out)) return `_${out}`
  return out
}

/**
 * Recursive emitter. `value` is the JSON node to serialise; `path`
 * is the macro-name prefix accumulated so far; `lines` is the output
 * buffer (mutated in place).
 *
 * Dispatches on the runtime type of `value`. Order of branches
 * matches the documented header shape (scalars, scalar arrays,
 * object arrays, nested objects).
 */
function walk(value: unknown, path: string, lines: string[]): void {
  if (value === null || value === undefined) return

  // Boolean / number / string — leaf.
  if (typeof value === 'boolean') {
    lines.push(`#define ${path} ${value ? 1 : 0}`)
    return
  }
  if (typeof value === 'number') {
    // Use Number.toString() to avoid locale-dependent formatting.
    // NaN / Infinity are not representable in C; skip them.
    if (!Number.isFinite(value)) return
    lines.push(`#define ${path} ${value.toString()}`)
    return
  }
  if (typeof value === 'string') {
    // Escape backslashes and quotes for inclusion as a C string
    // literal. Newlines are escaped as `\n` so a multi-line config
    // value (e.g. a textarea) still emits a single #define line.
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
    lines.push(`#define ${path} "${escaped}"`)
    return
  }

  if (Array.isArray(value)) {
    // Empty array: emit the count (zero) but no brace-initializer
    // — a `#define X {}` would expand to an invalid initializer in
    // C for non-zero-length arrays, and emitting it as `{}` then
    // having the driver instantiate `const T x[0]` is fragile.
    if (value.length === 0) {
      lines.push(`#define ${path}_COUNT 0`)
      return
    }

    // Distinguish a scalar array (numbers / booleans / strings) from
    // an array of objects. A mixed array (rare; signals a misshaped
    // screen value) is treated as an object array — safer to emit
    // per-index defines than to lose information.
    const allScalar = value.every((el) => el === null || ['boolean', 'number', 'string'].includes(typeof el))

    if (allScalar) {
      // Brace-initializer literal — driver consumes as
      // `const T arr[] = VPP_X;`. `null` slot becomes `0` so the
      // initializer is still well-formed; the driver should use the
      // companion `<path>_COUNT` (and any application-specific
      // sentinel) to detect holes.
      const formatted = value.map((el) => {
        if (el === null) return '0'
        if (typeof el === 'boolean') return el ? '1' : '0'
        if (typeof el === 'number') {
          if (!Number.isFinite(el)) return '0'
          return el.toString()
        }
        // string
        const escaped = String(el)
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r')
        return `"${escaped}"`
      })
      lines.push(`#define ${path}_COUNT ${value.length}`)
      lines.push(`#define ${path} { ${formatted.join(', ')} }`)
      return
    }

    // Array of objects (or mixed). Per-index expansion + a
    // convenience FOREACH macro the driver can use to unroll the
    // per-index defines into a struct-literal array without having
    // to enumerate indices by hand.  Usage in HAL code:
    //
    //   #define VPP_X(i) { VPP_FOO_##i##_BAR, VPP_FOO_##i##_BAZ },
    //   static const Foo arr[] = { VPP_FOO_FOREACH(VPP_X) };
    //
    // The driver supplies the inner per-entry transform; the macro
    // expands to the right number of `X(0) X(1) ... X(N-1)` calls
    // for the array length the editor saw at compile time.
    lines.push(`#define ${path}_COUNT ${value.length}`)
    for (let i = 0; i < value.length; i++) {
      walk(value[i], `${path}_${i}`, lines)
    }
    if (value.length > 0) {
      const expansions = Array.from({ length: value.length }, (_, i) => `X(${i})`).join(' ')
      lines.push(`#define ${path}_FOREACH(X) ${expansions}`)
    }
    return
  }

  if (typeof value === 'object') {
    // Sort object keys for deterministic output. Recurse with the
    // extended path.
    const obj = value as Record<string, unknown>
    const keys = Object.keys(obj).sort()
    for (const k of keys) {
      walk(obj[k], `${path}_${sanitize(k, false)}`, lines)
    }
    return
  }

  // Functions / symbols / etc. — not representable; skip silently.
}
