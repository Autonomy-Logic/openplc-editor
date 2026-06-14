/**
 * Edge-trigger instance variable (`R_TRIG1`, `F_TRIG1`, …) synthesised
 * by `extractModifier` when a contact/coil carries a rising/falling
 * edge modifier.  The walker accumulates these in its state, the wrap
 * declares them in the trailing local `VAR` section.
 */

export interface TriggerVar {
  /** `R_TRIG1`, `R_TRIG2`, … or `F_TRIG1`, `F_TRIG2`, … */
  name: string
  type: 'R_TRIG' | 'F_TRIG'
}
