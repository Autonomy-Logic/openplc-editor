import { zodResolver } from '@hookform/resolvers/zod'
import { debounce } from 'lodash'
import { FC, useCallback, useEffect } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router-dom'
import { z } from 'zod'

import { Button, Form, Table } from '@/components'
import { useProject } from '@/hooks'

/**
 * Functional component for managing variables in a POUs documentation
 * @component
 */
const Variables: FC = () => {
  /**
   * Access the translation function from 'react-i18next'
   * @useTranslation('variables')
   */
  const { t } = useTranslation('variables')
  /**
   * Extract the `pouName` from the route parameters
   */
  const { pouName } = useParams()
  /**
   * Access the `updateDocumentation` function from the custom hook
   * @useProject
   */
  const { updateDocumentation } = useProject()
  /**
   * Options for the 'class' field in the variables form
   * @type {Array<Object>}
   */
  const classesOptions = [
    {
      id: 0,
      label: t('all'),
      value: 'all',
    },
    {
      id: 1,
      label: t('interface'),
      value: 'interface',
    },
    {
      id: 2,
      label: t('input'),
      value: 'input',
      className: 'pl-4',
    },
    {
      id: 3,
      label: t('output'),
      value: 'output',
      className: 'pl-4',
    },
    {
      id: 4,
      label: t('inOut'),
      value: 'inOut',
      className: 'pl-4',
    },
    {
      id: 5,
      label: t('externals'),
      value: 'externals',
      className: 'pl-4',
    },
    {
      id: 6,
      label: t('variables'),
      value: 'variables',
    },
    {
      id: 7,
      label: t('local'),
      value: 'local',
      className: 'pl-4',
    },
    {
      id: 8,
      label: t('temp'),
      value: 'temp',
      className: 'pl-4',
    },
  ]

  /**
   * Zod schema for variables form data
   */
  const variablesSchema = z.object({
    description: z.string(),
    class: z.object({
      id: z.union([z.number(), z.string()]),
      label: z.string(),
      value: z.union([z.number(), z.string()]),
    }),
  })
  /**
   * Type for the data structure represented by the `variablesSchema`
   */
  type VariablesSchemaData = z.infer<typeof variablesSchema>
  /**
   * Initialize the variables form using the `useForm` hook
   */
  const variablesForm = useForm<VariablesSchemaData>({
    resolver: zodResolver(variablesSchema),
    defaultValues: {
      description: '',
      class: classesOptions[0],
    },
  })
  /**
   * Destructure `watch` from the `variablesForm` hook
   */
  const { watch } = variablesForm
  /**
   * Debounce the `updateDocumentation` function to update the documentation for the POU
   * @function
   */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const debouncedDescription = useCallback(
    debounce(
      (description) => pouName && 'To be implemented', // todo: Create function to update pou documentation
      // updateDocumentation({
      //   pouName,
      //   description,
      // }),
      1000,
    ),
    [],
  )
  /**
   * Listen to changes in the `description` field and debounce the updates
   */
  useEffect(() => {
    const subscription = watch(({ description }) => {
      debouncedDescription(description)
    })
    return () => subscription.unsubscribe()
  }, [debouncedDescription, watch])
  /**
   * Render the Variables component
   * @returns JSX Element
   */
  return (
    <div className="w-full py-4">
      <FormProvider {...variablesForm}>
        <form className="flex w-full flex-col gap-4">
          <Button className="ml-auto" type="button" label={t('addVariable')} />

          <div className="flex w-full items-center gap-4">
            <Form.Field className="w-full max-w-sm">
              <Form.Input
                type="text"
                name="description"
                placeholder={t('description')}
              />
            </Form.Field>
            <Form.Field className="w-full max-w-[12rem]">
              <Form.ComboBox
                name="class"
                options={classesOptions}
                optionsClassName="pl-8"
              />
            </Form.Field>
          </div>
          {/* <Table /> */}
        </form>
      </FormProvider>
    </div>
  )
}

export default Variables
