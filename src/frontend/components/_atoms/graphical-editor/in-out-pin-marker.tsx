/**
 * The ⟷ badge that marks a `VAR_IN_OUT` pin, drawn after the pin name (`State ⟷`).
 *
 * An in-out parameter has one pin, on the input side, so without a marker it is
 * indistinguishable from a plain input. CODESYS marks it the same way, with a left-right
 * arrow, which keeps the two editors readable in the same way for anyone moving between
 * them.
 *
 * It is drawn as an SVG rather than the `⟷` character: the glyph is missing from several of
 * the fonts the editors fall back to, and where it exists it sits on the baseline instead of
 * beside the pin name. The arrow is `w-3` (12px) and `ml-1` (4px) — together the
 * `IN_OUT_MARKER_WIDTH` that block sizing reserves, so a long in-out name plus the arrow
 * cannot overflow the block.
 */
const InOutPinMarker = () => (
  <span
    aria-label='in-out parameter'
    title='VAR_IN_OUT — passed by reference: the block writes back to this variable'
    className='pointer-events-none ml-1 inline-flex w-3 shrink-0 select-none items-center align-middle'
  >
    <svg viewBox='0 0 12 9' fill='none' className='h-[9px] w-3' aria-hidden='true'>
      <path
        d='M3.4 1.7 1.1 4.5l2.3 2.8M8.6 1.7l2.3 2.8-2.3 2.8M1.1 4.5h9.8'
        stroke='currentColor'
        strokeWidth='1.2'
        strokeLinecap='round'
        strokeLinejoin='round'
      />
    </svg>
  </span>
)

export { InOutPinMarker }
