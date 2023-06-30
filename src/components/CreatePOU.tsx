import { zodResolver } from '@hookform/resolvers/zod'
import { CONSTANTS } from '@shared/constants'
import { FC } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button, Form } from '@/components'
import { useModal, useProject } from '@/hooks'

const { languages, types } = CONSTANTS

const CreateNewPOU: FC = () => {
  const { createPOU } = useProject()
  const { handleCloseModal } = useModal()
  const { t: translate } = useTranslation()
  const { t } = useTranslation('createPOU')

  const createPOUSchema = z.object({
    name: z.string().nonempty({
      message: t('errors.name'),
    }),
    type: z.object(
      {
        id: z.union([z.number(), z.string()]),
        label: z.string(),
        value: z.union([z.number(), z.string()]),
      },
      { required_error: t('errors.type') },
    ),
    language: z.object(
      {
        id: z.union([z.number(), z.string()]),
        label: z.string(),
        value: z.union([z.number(), z.string()]),
      },
      { required_error: t('errors.language') },
    ),
  })

  type createPOUSchemaData = z.infer<typeof createPOUSchema>

  const typeOptions = [{ id: 0, label: types.PROGRAM, value: types.PROGRAM }]

  const languageOptions = [{ id: 0, label: languages.LD, value: languages.LD }]

  const handleCancel = () => {
    createPOU({
      type: typeOptions[0].value as string,
    })
    handleCloseModal()
  }

  const createPouForm = useForm<createPOUSchemaData>({
    resolver: zodResolver(createPOUSchema),
    defaultValues: {
      name: 'program0',
      type: typeOptions[0],
    },
  })

  const handleCreatePOU = async (data: createPOUSchemaData) => {
    const {
      type: { value: type },
      language: { value: language },
      name,
    } = data
    createPOU({
      name,
      type: type as string,
      language: language as string,
    })
    handleCloseModal()
  }

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = createPouForm

  return (
    <div className="p-8">
      <FormProvider {...createPouForm}>
        <form
          onSubmit={handleSubmit(handleCreatePOU)}
          className="grid w-full grid-cols-2 grid-rows-3 gap-x-4"
        >
          <Form.Field className="col-span-full">
            <Form.Label htmlFor="name"> {t('labels.name')}</Form.Label>
            <Form.Input type="name" name="name" />
            <Form.ErrorMessage field="name" />
          </Form.Field>
          <Form.Field>
            <Form.Label htmlFor="type"> {t('labels.type')}</Form.Label>
            <Form.ComboBox name="type" options={typeOptions} />
            <Form.ErrorMessage field="type" />
          </Form.Field>
          <Form.Field>
            <Form.Label htmlFor="language"> {t('labels.language')}</Form.Label>
            <Form.ComboBox
              name="language"
              options={languageOptions}
              showOptions={2}
            />
            <Form.ErrorMessage field="language" />
          </Form.Field>
          <Form.Field className="col-start-2 mt-auto flex h-10 flex-row gap-4">
            <Button
              label={translate('buttons.ok')}
              disabled={isSubmitting}
              widthFull
            />
            <Button
              type="button"
              appearance="secondary"
              label={translate('buttons.cancel')}
              disabled={isSubmitting}
              onClick={handleCancel}
              widthFull
            />
          </Form.Field>
        </form>
      </FormProvider>
    </div>
  )
}

export default CreateNewPOU
