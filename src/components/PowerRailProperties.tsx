import { zodResolver } from '@hookform/resolvers/zod'
import { FC, useEffect, useState } from 'react'
import { FormProvider, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useReactFlow, XYPosition } from 'reactflow'
import { z } from 'zod'

import { Button, Form } from '@/components'
import { useModal } from '@/hooks'
import { classNames } from '@/utils'

type PowerRailPropertiesProps = {
  position: XYPosition
}

const PowerRailProperties: FC<PowerRailPropertiesProps> = ({ position }) => {
  const { addNodes } = useReactFlow()
  const { handleCloseModal } = useModal()
  const { t: translate } = useTranslation()
  const { t } = useTranslation('powerRailProperties')
  const [pinNumber, setPinNumber] = useState(1)
  const [pinPosition, setPinPosition] = useState('left')

  const powerRailPropertiesSchema = z.object({
    pinPosition: z.string(),
    pinNumber: z.number(),
  })

  type PowerRailPropertiesSchemaData = z.infer<typeof powerRailPropertiesSchema>

  const powerRailPropertiesForm = useForm<PowerRailPropertiesSchemaData>({
    resolver: zodResolver(powerRailPropertiesSchema),
    defaultValues: {
      pinPosition: 'left',
      pinNumber: 1,
    },
  })

  const handleCreatePowerRailProperties = async (
    data: PowerRailPropertiesSchemaData,
  ) => {
    addNodes({
      id: crypto.randomUUID(),
      type: 'powerRail',
      position,
      data,
    })
    handleCloseModal()
  }

  const {
    handleSubmit,
    formState: { isSubmitting },
    watch,
  } = powerRailPropertiesForm

  useEffect(() => {
    const subscription = watch(({ pinPosition, pinNumber }) => {
      if (pinNumber) setPinNumber(pinNumber)
      if (pinPosition) setPinPosition(pinPosition)
    })
    return () => subscription.unsubscribe()
  }, [watch])

  return (
    <div className="h-full w-full p-8">
      <FormProvider {...powerRailPropertiesForm}>
        <form
          onSubmit={handleSubmit(handleCreatePowerRailProperties)}
          className="h-full w-full"
        >
          <div className="mb-8 flex h-full w-full items-center justify-between">
            <div className="h-full w-full">
              <Form.Field className="col-span-full">
                <Form.Radio name="pinPosition" label={t('left')} value="left" />
                <Form.ErrorMessage field="pinPosition" />
              </Form.Field>
              <Form.Field className="col-span-full">
                <Form.Radio
                  name="pinPosition"
                  label={t('right')}
                  value="right"
                />
                <Form.ErrorMessage field="pinPosition" />
              </Form.Field>
              <Form.Field>
                <Form.Label htmlFor="pinNumber"> {t('pinNumber')}</Form.Label>
                <Form.Input type="number" name="pinNumber" min="1" />
              </Form.Field>
            </div>
            <div className="flex h-full w-full  items-center justify-center">
              <div className="mx-6 flex h-36 w-1 flex-col justify-around rounded bg-black">
                {[...Array(pinNumber)].map((_, index) => (
                  <div
                    key={index}
                    className={classNames(
                      'h-[0.125rem] w-6 bg-black',
                      pinPosition === 'left' && '-ml-6',
                    )}
                  />
                ))}
              </div>
            </div>
          </div>
          <Form.Field className="col-start-2 mt-auto flex h-10 flex-row gap-4">
            <Button
              type="submit"
              label={translate('buttons.ok')}
              disabled={isSubmitting}
              widthFull
            />
            <Button
              type="button"
              appearance="secondary"
              label={translate('buttons.cancel')}
              disabled={isSubmitting}
              onClick={handleCloseModal}
              widthFull
            />
          </Form.Field>
        </form>
      </FormProvider>
    </div>
  )
}

export default PowerRailProperties
