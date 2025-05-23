import { StXML } from '@root/types/PLC/xml-data/pous/languages/st-diagram'

const stToXML = (value: string) => {
  const stXML: {
    body: {
      ST: StXML
    }
  } = {
    body: {
      ST: {
        'xhtml:p': {
          $: value,
        },
      },
    },
  }

  return stXML
}

export { stToXML }
