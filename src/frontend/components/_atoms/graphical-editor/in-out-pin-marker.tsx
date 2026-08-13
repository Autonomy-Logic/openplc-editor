/**
 * The ⟷ badge drawn over a `VAR_IN_OUT` pin.
 *
 * An in-out parameter has one pin, on the input side, so without a marker it is
 * indistinguishable from a plain input. CODESYS solves this the same way — a small
 * left-right arrow above the pin — so the badge keeps the two editors readable in the same
 * way for anyone moving between them.
 */
const InOutPinMarker = () => (
  <span
    aria-label='in-out parameter'
    title='VAR_IN_OUT — passed by reference: the block writes back to this variable'
    className='pointer-events-none absolute -top-[9px] left-0 select-none text-[9px] leading-none text-neutral-1000 dark:text-neutral-50'
  >
    ⟷
  </span>
)

export { InOutPinMarker }
