// Review this eslint rule
/* eslint-disable react/jsx-props-no-spreading */
// Review this eslint rule
/* eslint-disable react/function-component-definition */
import { zodResolver } from '@hookform/resolvers/zod';
import { FC } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';
import { CONSTANTS } from '@/utils';

import { Button, Form } from '.';
import { useModal } from 'renderer/hooks';
import useOpenPLCStore from 'renderer/store';

import { CreatePouDto } from 'renderer/contracts/dtos';
/**
 * Destructure needed constants from the shared CONSTANTS module
 */
const { languages, types } = CONSTANTS;
/**
 * Component to create a new POU (Program Organization Unit).
 */
const CreateNewPOU: FC = () => {
  const createPou = useOpenPLCStore.useAddPou();
  const { handleCloseModal } = useModal();
  const { t: translate } = useTranslation();
  const { t } = useTranslation('createPOU');
  /**
   * Define a schema for validating the form data
   */
  const createPOUSchema = z.object({
    '@name': z.string(),
    '@pouType': z
      .string()
      .refine((type) => Object.values(types).includes(type), {
        message: 'Invalid POU type',
      }),
    body: z.record(
      z.enum(['IL', 'ST']),
      z.object({
        'xhtml:p': z.object({
          $: z.string(),
        }),
      }),
    ),
  });
  /**
   * Prepare options for the type and language dropdowns
   */
  const typeOptions = [
    { id: 0, label: types.PROGRAM, value: types.PROGRAM },
    { id: 1, label: types.FUNCTION, value: types.FUNCTION },
    { id: 2, label: types.FUNCTION_BLOCK, value: types.FUNCTION_BLOCK },
  ];

  const languageOptions = [
    { id: 0, label: languages.IL, value: languages.IL },
    { id: 1, label: languages.ST, value: languages.ST },
  ];
  /**
   *  Handler for cancel button
   */
  const handleCancel = () => {
    handleCloseModal();
  };
  /**
   * Initialize the form using react-hook-form
   */
  const createPouForm = useForm<CreatePouDto>({
    resolver: zodResolver(createPOUSchema),
    defaultValues: {
      name: 'program0',
      type: typeOptions[0].value,
    },
  });
  /**
   * Handler for form submission
   */
  const handleCreatePOU = async ({ type, language, name }: CreatePouDto) => {
    createPou({
      name,
      type,
      language,
    });
    handleCloseModal();
  };
  /**
   * Extract necessary functions and data from the form
   */
  const {
    handleSubmit,
    formState: { isSubmitting },
  } = createPouForm;

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
  );
};

export default CreateNewPOU;
