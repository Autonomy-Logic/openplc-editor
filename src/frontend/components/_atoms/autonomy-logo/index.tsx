/**
 * The Autonomy `<>` mark, as Edge's sign-in screen shows it.
 *
 * Copied path-for-path from `@autonomy-edge/assets`, which belongs to another
 * repository this project cannot import. The mark is what tells a user at a glance
 * which account the form is asking for, so it has to be the same one.
 */
const AutonomyLogo = ({ className }: { className?: string }) => (
  // Explicit width/height, not just a viewBox: with no intrinsic size the mark
  // collapses to nothing inside a flex container, which is how it vanished.
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 124 86' width={58} height={40} aria-hidden className={className}>
    <path
      className='fill-current'
      d='M41.892 0 0 43l41.892 43 9.216-9.653-25.56-25.985c-1.877-1.907-4.389-2.974-7.003-2.974H11.73v-8.776h6.815c2.614 0 5.126-1.067 7.002-2.974L51.108 9.653zM82.108 0 124 43 82.108 86l-9.216-9.653 25.56-25.985c1.877-1.907 4.389-2.974 7.003-2.974h6.815v-8.776h-6.815c-2.614 0-5.126-1.067-7.002-2.974L72.892 9.653z'
    />
  </svg>
)

export { AutonomyLogo }
