/**
 * Free text inside an IEC 61131-3 `(* … *)` comment.
 *
 * A POU file opens with its documentation as a leading comment, and the
 * comment ends at the first `*)` — so documentation that itself contained one
 * (`(* see note *)`, or a sentence ending `x*)`) closed the comment early. The
 * rest of the text then sat in front of the POU header, and the next load
 * failed with "Could not find FUNCTION_BLOCK declaration". A `(*` matters too:
 * a compiler that nests comments would read it as an unclosed inner comment.
 *
 * Each delimiter is broken with a backslash: `*)` is written `*\)` and `(*` is
 * written `(\*`. The scheme is reversible for any text because a run of
 * backslashes already standing between the two characters gets one more on
 * write and loses one on read — so `*\)` in the original comes back as `*\)`,
 * not as `*)`. Text with neither delimiter (and no such run) is written as is,
 * which keeps every file saved before this byte-for-byte unchanged.
 */

const CLOSE_RUN = /\*(\\*)\)/g
const OPEN_RUN = /\((\\*)\*/g
const ESCAPED_CLOSE_RUN = /\*\\(\\*)\)/g
const ESCAPED_OPEN_RUN = /\(\\(\\*)\*/g

/** Text safe to place between `(*` and `*)`: it contains neither delimiter. */
export function escapeCommentText(text: string): string {
  return text.replace(OPEN_RUN, '(\\$1*').replace(CLOSE_RUN, '*\\$1)')
}

/** The inverse of `escapeCommentText`. */
export function unescapeCommentText(text: string): string {
  return text.replace(ESCAPED_CLOSE_RUN, '*$1)').replace(ESCAPED_OPEN_RUN, '($1*')
}
