import { IlXML } from '@root/types/PLC/xml-data/old-editor'

const convertComments = (value: string) => {
  let stringContext = ''
  let commentContext = ''
  let outValue = value
    .split('')
    .map((iChar, i, original) => {
      if (stringContext) {
        if (original[i - 1] === '$') {
          return iChar
        } else if (iChar == stringContext) {
          stringContext = ''
          return iChar
        }
        return iChar
      }
      if (`'"`.includes(iChar) && !commentContext) {
        stringContext = iChar
        return iChar
      }
      const nextTwoChars = original.slice(i, i + 2).join('')
      if (commentContext) {
        if ('//' == commentContext && (nextTwoChars == '\r\n' || iChar == '\n')) {
          commentContext = ''
          return '*)' + iChar
        }
        const lastTwoChars = original.slice(i - 2, i).join('')
        if ('(*' == commentContext && lastTwoChars == '*)') {
          commentContext = ''
          return iChar
        }
        if ('/*' == commentContext && lastTwoChars == '*/' && original.slice(i - 3, i - 1).join('') != '/*') {
          commentContext = ''
          return '*)' + iChar
        }
        const prevTwoChars = original.slice(i - 1, i + 1).join('')
        if ('(*' != commentContext && prevTwoChars == '*)') {
          return '_' + iChar
        }
        return iChar
      }
      if (['//', '(*', '/*'].includes(nextTwoChars) && !stringContext) {
        commentContext = nextTwoChars
        if (['//', '/*'].includes(commentContext)) {
          return '(*' + iChar
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

const ilToXML = (value: string) => {
  const ilXML: {
    body: {
      IL: IlXML
    }
  } = {
    body: {
      IL: {
        'xhtml:p': {
          $: convertComments(value),
        },
      },
    },
  }

  return ilXML
}

export { ilToXML }
