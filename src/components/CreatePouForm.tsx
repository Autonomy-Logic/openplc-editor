import { zodResolver } from '@hookform/resolvers/zod'
import { CONSTANTS } from '@shared/constants'
import { FC } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { Button, Form } from '@/components'
import { useModal, useProject } from '@/hooks'
/**
 * Destructure needed constants from the shared CONSTANTS module
 */
const { languages, types } = CONSTANTS
/**
 * Component to create a new POU (Program Organization Unit).
 */
const CreatePouForm: FC = () => {
  const { createProgramOrganizationUnit } = useProject()
  const { handleCloseModal } = useModal()
  const { t: translate } = useTranslation()
  const { t } = useTranslation('createPOU')
  /**
   * Define a schema for validating the form data
   */
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

  type CreatePOUSchemaData = z.infer<typeof createPOUSchema>
  /**
   * Prepare options for the type and language dropdowns
   */
  const typeOptions = [
    { id: 0, label: types.PROGRAM, value: types.PROGRAM },
    { id: 1, label: types.FUNCTION, value: types.FUNCTION },
    { id: 2, label: types.FUNCTION_BLOCK, value: types.FUNCTION_BLOCK },
  ]

  const languageOptions = [
    { id: 0, label: languages.LD, value: languages.LD },
    { id: 1, label: languages.FBD, value: languages.FBD },
    { id: 2, label: languages.SFC, value: languages.SFC },
    { id: 3, label: languages.IL, value: languages.IL },
    { id: 4, label: languages.ST, value: languages.ST },
  ]
  /**
   *  Handler for cancel button
   */
  const handleCancel = () => {
    createProgramOrganizationUnit({
      type: typeOptions[0].value as string,
      name: 'DummyProgramOrganizationUnit',
    })
    handleCloseModal()
  }
  /**
   * Initialize the form using react-hook-form
   */
  const createPouForm = useForm<CreatePOUSchemaData>({
    resolver: zodResolver(createPOUSchema),
    defaultValues: {
      name: 'program0',
      type: typeOptions[0],
      language: languageOptions[0],
    },
  })
  /**
   * Handler for form submission
   */
  const handleCreatePOU = async (data: CreatePOUSchemaData) => {
    const {
      type: { value: type },
      language: { value: language },
      name,
    } = data
    createProgramOrganizationUnit({
      name,
      type: type as string,
      language: language as string,
    })
    handleCloseModal()
  }
  /**
   * Extract necessary functions and data from the form
   */
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

export default CreatePouForm