import { IlXML } from "@root/types/PLC/xml-data/old-editor"

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
