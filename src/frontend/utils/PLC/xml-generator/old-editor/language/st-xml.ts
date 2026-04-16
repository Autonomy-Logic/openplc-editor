import { StXML } from '@root/middleware/shared/ports/xml-types/old-editor/pous/languages/st-diagram'

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
