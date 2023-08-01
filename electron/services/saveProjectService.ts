import { writeFile } from 'node:fs'
import { join } from 'node:path'

import { i18n } from '@shared/i18n'
import { create } from 'xmlbuilder2'
import { XMLSerializedAsObject } from 'xmlbuilder2/lib/interfaces'

import { ServiceResponse } from './types/response'

const saveProjectService = {
  async execute(
    filePath: string,
    xmlSerializedAsObject: XMLSerializedAsObject,
  ): Promise<ServiceResponse<string>> {
    if (!filePath || !xmlSerializedAsObject)
      return {
        ok: false,
        reason: {
          title: i18n.t('saveProject:errors.failedToSaveFile.title'),
          description: i18n.t(
            'saveProject:errors.failedToSaveFile.description',
          ),
        },
      }

    filePath = join(filePath, 'plc.xml')
    const xmlBuilder = create(xmlSerializedAsObject)
    let failedToSaveFile = false
    const plc = xmlBuilder.end({ prettyPrint: true })

    writeFile(filePath, plc, (error) => {
      if (error) failedToSaveFile = true
    })

    if (failedToSaveFile)
      return {
        ok: false,
        reason: {
          title: i18n.t('saveProject:errors.failedToSaveFile.title'),
          description: i18n.t(
            'saveProject:errors.failedToSaveFile.description',
          ),
        },
      }

    return {
      ok: true,
      reason: {
        title: i18n.t('saveProject:success.successToSaveFile.title'),
        description: i18n.t(
          'saveProject:success.successToSaveFile.description',
        ),
      },
    }
  },
}

export default saveProjectService
