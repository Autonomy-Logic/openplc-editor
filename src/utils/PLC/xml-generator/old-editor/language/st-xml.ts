import { StXML } from '@root/types/PLC/xml-data/old-editor/pous/languages/st-diagram'

const convertComments = (value: string) => {
  let stringContext = '' // either empty for non-string or " || ' to signal type of string
  let commentContext = '' // either empty for non-comment or // || (* || /*
  let outValue = value
    .split('')
    .map((iChar, i, original) => {
      // matiec does not support // or /* ... */ comments, so wrap those in (* ... *) during this conversion step
      /* CONTEXTUALIZE STRINGS */
      if (stringContext) {
        if (original[i - 1] === '$') {
          // check for escape char, doesn't matter what current (char is, note Array[-1] is just undefined
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
      const nextTwoChars = original.slice(i, i + 2).join('') // inclusive of iChar
      if (commentContext) {
        if ('//' == commentContext && (nextTwoChars == '\r\n' || iChar == '\n')) {
          commentContext = ''
          return '*)' + iChar
        }
        const lastTwoChars = original.slice(i - 2, i).join('') // exclusive of iChar
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

const stToXML = (value: string) => {
  const stXML: {
    body: {
      ST: StXML
    }
  } = {
    body: {
      ST: {
        'xhtml:p': {
          $: convertComments(value),
        },
      },
    },
  }

  return stXML
}

export { stToXML }
