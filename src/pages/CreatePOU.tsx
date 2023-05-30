import { zodResolver } from '@hookform/resolvers/zod';
import React, { useEffect } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { Button, Form } from '@/components';
import { useTitlebar } from '@/hooks';

const CreateNewPOU: React.FC = () => {
  const { dispose } = useTitlebar();
  const { t } = useTranslation('createPOU');

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
  });

  type createPOUSchemaData = z.infer<typeof createPOUSchema>;

  const typeOptions = [{ id: 0, label: 'program', value: 'program' }];

  const languageOptions = [
    { id: 0, label: 'IL', value: 'IL' },
    { id: 1, label: 'ST', value: 'ST' },
    { id: 2, label: 'LD', value: 'LD' },
    { id: 3, label: 'FBD', value: 'FBD' },
    { id: 4, label: 'SFC', value: 'SFC' },
  ];

  useEffect(() => {
    dispose();
  }, [dispose]);

  const handleCancel = () => {
    window.close();
  };

  const createPouForm = useForm<createPOUSchemaData>({
    resolver: zodResolver(createPOUSchema),
    defaultValues: {
      name: 'program0',
      type: typeOptions[0],
    },
  });

  const createPOU = async (data: createPOUSchemaData) => {
    console.log(data);
    window.close();
  };

  const {
    handleSubmit,
    formState: { isSubmitting },
  } = createPouForm;

  return (
    <div className="h-screen w-screen p-8">
      <FormProvider {...createPouForm}>
        <form
          onSubmit={handleSubmit(createPOU)}
          className="grid grid-cols-2 grid-rows-3 gap-x-4 w-full"
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
            <Form.ComboBox name="language" options={languageOptions} showOptions={2} />
            <Form.ErrorMessage field="language" />
          </Form.Field>
          <Form.Field className="flex flex-row h-10 mt-8 gap-4 col-start-2">
            <Button label="OK" disabled={isSubmitting} widthFull />
            <Button
              type="button"
              appearance="secondary"
              label="Cancel"
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
