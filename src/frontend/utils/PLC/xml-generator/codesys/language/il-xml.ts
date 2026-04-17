import { IlXML } from '@root/middleware/shared/ports/xml-types/codesys'

const ilToXML = (value: string) => {
  const ilXML: {
    body: {
      IL: IlXML
    }
  } = {
    body: {
      IL: {
        xhtml: {
          '@xmlns': 'http://www.w3.org/1999/xhtml',
          $: value,
        },
      },
    },
  }

  return ilXML
}

export { ilToXML }
