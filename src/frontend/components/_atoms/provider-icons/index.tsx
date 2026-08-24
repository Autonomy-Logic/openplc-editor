import type { EdgeOAuthProviderId } from '../../../../middleware/shared/ports/edge-account-port'

/**
 * Brand marks for the sign-in providers.
 *
 * Copied path-for-path from Edge's `@autonomy-edge/assets` rather than redrawn:
 * that package belongs to another repository this project does not depend on, and
 * the point is for the two sign-in screens to be indistinguishable. Monochrome for
 * the same reason — Edge renders them tinted to the foreground colour, not in
 * brand colours.
 */
const GoogleMark = () => (
  <svg xmlns='http://www.w3.org/2000/svg' width={18} height={18} fill='none' aria-hidden>
    <g className='fill-current' clipPath='url(#editor_google_svg__a)'>
      <path d='M17.405 9.198c0-.583-.047-1.169-.148-1.742H9.172v3.3h4.63a3.97 3.97 0 0 1-1.714 2.605v2.142h2.763c1.621-1.493 2.554-3.697 2.554-6.305' />
      <path d='M9.171 17.573c2.312 0 4.262-.76 5.682-2.07l-2.762-2.141c-.768.522-1.76.819-2.916.819-2.237 0-4.133-1.51-4.813-3.537h-2.85v2.207a8.57 8.57 0 0 0 7.66 4.722' />
      <path d='M4.36 10.643a5.13 5.13 0 0 1 0-3.282V5.153H1.512a8.58 8.58 0 0 0 0 7.698z' />
      <path d='M9.171 3.821a4.66 4.66 0 0 1 3.289 1.285l2.447-2.447A8.24 8.24 0 0 0 9.17.43a8.57 8.57 0 0 0-7.66 4.725L4.36 7.36c.677-2.031 2.576-3.54 4.812-3.54' />
    </g>
    <defs>
      <clipPath id='editor_google_svg__a'>
        <path fill='#fff' d='M.429.429h17.143v17.143H.429z' />
      </clipPath>
    </defs>
  </svg>
)

/**
 * `viewBox` is required here, unlike Google's mark above.
 *
 * This path is drawn on a 0–20 grid (`M20 0`, `V20`), so without a viewBox the user
 * units map 1:1 to px and everything past 18 is simply cut off — the right-hand and
 * bottom squares of the four-square logo rendered clipped, and the mark sat
 * asymmetrically beside Google's, whose path already fits inside 18×18.
 */
const MicrosoftMark = () => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20' width={18} height={18} fill='none' aria-hidden>
    <path
      className='fill-current'
      d='M9.328 0H0v8.988h9.328zM20 0h-9.327v8.988H20zM9.328 10.264H0V20h9.328zm10.672 0h-9.327V20H20z'
    />
  </svg>
)

const AppleMark = () => (
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width={20} height={20} fill='none' aria-hidden>
    <g className='fill-current' clipPath='url(#editor_apple_svg__a)'>
      <path d='M16.773.012c-.051-.057-1.889.023-3.488 1.758-1.599 1.734-1.353 3.723-1.317 3.774s2.28.13 3.713-1.887C17.113 1.64 16.824.071 16.773.012m4.97 17.6c-.071-.144-3.487-1.851-3.169-5.133s2.513-4.184 2.547-4.281c.035-.098-.895-1.185-1.88-1.736a5.55 5.55 0 0 0-2.345-.651c-.162-.004-.725-.142-1.881.174-.762.209-2.48.884-2.952.91-.474.028-1.884-.782-3.4-.997-.971-.187-2 .197-2.737.492-.735.294-2.133 1.131-3.11 3.356-.979 2.223-.467 5.745-.101 6.84s.937 2.886 1.91 4.194c.863 1.476 2.01 2.5 2.488 2.848s1.828.579 2.764.1c.753-.462 2.112-.727 2.65-.708.535.02 1.59.232 2.672.809.857.296 1.667.172 2.478-.157.812-.332 1.986-1.589 3.357-4.137q.78-1.778.71-1.924' />
    </g>
    <defs>
      <clipPath id='editor_apple_svg__a'>
        <path fill='#fff' d='M0 0h24v24H0z' />
      </clipPath>
    </defs>
  </svg>
)

const MARKS = {
  google: GoogleMark,
  microsoft: MicrosoftMark,
  apple: AppleMark,
} as const

const ProviderIcon = ({ provider }: { provider: EdgeOAuthProviderId }) => {
  const Mark = MARKS[provider]

  return <Mark />
}

export { ProviderIcon }
