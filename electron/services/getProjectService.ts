import { readFile } from 'node:fs'
import { join } from 'node:path'

import { i18n } from '@shared/i18n'
import { convert } from 'xmlbuilder2'

import { ServiceResponse } from './types/response'

type XmlSerialized = {
  [key: string]: string | XmlSerialized
}

type GetProjectServiceResponse = ServiceResponse<XmlSerialized>

const getProjectService = {
  async execute(path: string): Promise<GetProjectServiceResponse> {
    path = join(path, 'plc.xml')

    const file = await new Promise((resolve, reject) =>
      readFile(path, 'utf-8', (error, data) => {
        if (error) return reject(error)
        return resolve(data)
      }),
    )

    if (!file) {
      return {
        ok: false,
        reason: {
          title: i18n.t('getProject:errors.readFile.title'),
          // eslint-disable-next-line @typescript-eslint/ban-ts-comment
          // @ts-ignore
          description: i18n.t('getProject:errors.readFile.description', {
            path,
          }),
        },
      }
    }

    return {
      ok: true,
      data: convert(file, { format: 'object' }) as XmlSerialized,
    }
  },
}

export default getProjectService