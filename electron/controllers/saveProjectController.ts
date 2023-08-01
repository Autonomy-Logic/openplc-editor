import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { saveProjectService } from '../services'

const saveProjectController = {
  async handle(filePath: string, xmlSerializedAsObject: XMLSerializedAsObject) {
    const result = await saveProjectService.execute(
      filePath,
      xmlSerializedAsObject,
    )
    return result
  },
}

export default saveProjectController
