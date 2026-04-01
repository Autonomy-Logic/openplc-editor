import { IlXML } from '@root/middleware/shared/ports/xml-types/old-editor'

const ilToXML = (value: string) => {
  const ilXML: {
    body: {
      IL: IlXML
    }
  } = {
    body: {
      IL: {
        'xhtml:p': {
          $: value,
        },
      },
    },
  }

  return ilXML
}

export { ilToXML }
