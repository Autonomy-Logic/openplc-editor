import { XMLSerializedAsObjectProps } from '@shared/types/xmlSerializedAsObject'

import { saveProjectService } from '../services'

const saveProjectController = {
  async handle(
    filePath: string,
    xmlSerializedAsObject: XMLSerializedAsObjectProps,
  ) {
    const result = await saveProjectService.execute(
      filePath,
      xmlSerializedAsObject,
    )
    return result
  },
}

export default saveProjectController
