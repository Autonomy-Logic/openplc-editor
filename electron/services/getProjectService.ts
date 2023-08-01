import { readFile } from 'node:fs'
import { join } from 'node:path'

import { i18n } from '@shared/i18n'
import { XMLSerializedAsObjectProps } from '@shared/types/xmlSerializedAsObject'
import { convert } from 'xmlbuilder2'

import { ServiceResponse } from './types/response'

type GetProjectServiceResponse = ServiceResponse<XMLSerializedAsObjectProps>

const getProjectService = {
  async execute(filePath: string): Promise<GetProjectServiceResponse> {
    filePath = join(filePath, 'plc.xml')

    const file = await new Promise((resolve, reject) =>
      readFile(filePath, 'utf-8', (error, data) => {
        if (error) return reject(error)
        return resolve(data)
      }),
    )

    if (!file) {
      return {
        ok: false,
        reason: {
          title: i18n.t('getProject:errors.readFile.title'),
          description: i18n.t('getProject:errors.readFile.description', {
            filePath,
          }),
        },
      }
    }

    return {
      ok: true,
      data: {
        xmlSerializedAsObject: convert(file, {
          format: 'object',
        }) as XMLSerializedAsObjectProps,
      },
    }
  },
}

export default getProjectService
