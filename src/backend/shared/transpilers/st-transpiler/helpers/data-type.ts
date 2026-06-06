/**
 * `"D::" + name` — data-type-tagged identifier used as the first
 * field of Program-chunk location tuples for `TYPE … END_TYPE` body
 * fragments.  Mirrors `ComputeDataTypeName`
 * (`plcopen/types_enums.py:142`).
 */

export function ComputeDataTypeName(datatype: string): string {
  return `D::${datatype}`
}
