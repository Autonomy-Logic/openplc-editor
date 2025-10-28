/**
 * Wraps unsupported comment styles into IEC 61131-3 standard comments.
 * Converts // and slash-star comments into (* *) format.
 * This is needed because the MatIEC compiler only accepts (* *) comment blocks.
 *
 * This function should only be applied to ST and IL code, NOT to Python or C++ code.
 *
 * Escape handling: Backslash escapes are handled by counting consecutive backslashes.
 * The $ character is treated as an escape character for any following character, which is
 * a custom extension and not strictly IEC 61131-3 compliant (standard only allows $$, $', $").
 *
 * @param value - The code string to process
 * @returns The code with unsupported comments wrapped in (* *)
 */
export const wrapUnsupportedComments = (value: string): string => {
  let stringContext = '' // either empty for non-string or " || ' to signal type of string
  let commentContext = '' // either empty for non-comment or // || (* || /*
  let cBlockDepth = 0 // track nesting depth of {{ ... }} C code blocks
  let outValue = value
    .split('')
    .map((iChar, i, original) => {
      const nextTwoChars = original.slice(i, i + 2).join('') // inclusive of iChar
      const lastTwoChars = original.slice(i - 2, i).join('') // exclusive of iChar

      if (nextTwoChars === '{{') {
        cBlockDepth++
      } else if (lastTwoChars === '}}') {
        cBlockDepth--
      }

      if (cBlockDepth > 0) {
        return iChar
      }

      /* CONTEXTUALIZE STRINGS */
      if (stringContext) {
        let backslashCount = 0
        for (let j = i - 1; j >= 0 && original[j] === '\\'; j--) {
          backslashCount++
        }
        if (backslashCount % 2 === 1 || original[i - 1] === '$') {
          return iChar
        } else if (iChar == stringContext) {
          stringContext = ''
          return iChar
        }
        return iChar
      }
      // test for string context (exclude comment context)
      if (`'"`.includes(iChar) && !commentContext) {
        // NOTE: "" / WSTRING (utf-16) currently unsupported by editor, but am future proofing
        stringContext = iChar
        return iChar
      }
      // CONTEXTUALIZE COMMENTS
      if (commentContext) {
        if ('//' == commentContext && (nextTwoChars == '\r\n' || iChar == '\n')) {
          commentContext = ''
          return '*)' + iChar
        }
        if ('(*' == commentContext && lastTwoChars == '*)') {
          commentContext = ''
          return iChar
        }
        if ('/*' == commentContext && lastTwoChars == '*/' && original.slice(i - 3, i - 1).join('') != '/*') {
          // the term with slice -3 .. -1 is for a sneaky case where /*/ would otherwise be interpreted as a closed comment
          commentContext = ''
          return '*)' + iChar
        }
        const prevTwoChars = original.slice(i - 1, i + 1).join('') // INCLUSIVE of iChar
        if ('(*' != commentContext && prevTwoChars == '*)') {
          return '_' + iChar // for the case where a non-(**) comment contains a closing *) - need to break it or this workaround doesn't work
        }
        return iChar
      }
      // test for comment context (exclude string context)
      if (['//', '(*', '/*'].includes(nextTwoChars) && !stringContext) {
        commentContext = nextTwoChars
        if (['//', '/*'].includes(commentContext)) {
          // patch for comments unsupported by matiec (*only these are supported*)
          return '(*' + iChar // yes, will keep the original comment chars, it is inconsequential
        }
        return iChar
      }
      return iChar
    })
    .join('')
  if (commentContext) {
    outValue += '*)'
  }
  return outValue
}
