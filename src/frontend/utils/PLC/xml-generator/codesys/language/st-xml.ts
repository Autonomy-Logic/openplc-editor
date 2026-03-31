import { StXML } from '@root/types/PLC/xml-data/codesys/pous/languages/st-diagram'

const stToXML = (value: string) => {
  const stXML: {
    body: {
      ST: StXML
    }
  } = {
    body: {
      ST: {
        xhtml: {
          '@xmlns': 'http://www.w3.org/1999/xhtml',
          $: value,
        },
      },
    },
  }

  return stXML
}

export { stToXML }
