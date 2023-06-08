import { zodResolver } from '@hookform/resolvers/zod';
import React, { useState } from 'react';
import { FormProvider, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { HiArrowSmallUp, HiPlusSmall } from 'react-icons/hi2';
import { ResizableBox } from 'react-resizable';
import { z } from 'zod';

import { Form, Tabs, Tooltip } from '@/components';

const comboboxSchema = z.object({
  combobox: z.object({
    id: z.union([z.number(), z.string()]),
    label: z.string(),
    value: z.union([z.number(), z.string()]),
  }),
});

type CreateComboboxData = z.infer<typeof comboboxSchema>;

const LeftColumn: React.FC = () => {
  const { t } = useTranslation('leftColumnTabs');

  const [current, setCurrent] = useState(0);
  const createComboboxForm = useForm<CreateComboboxData>({
    resolver: zodResolver(comboboxSchema),
  });

  const leftColumnTabs = [
    {
      id: 0,
      name: t('project'),
      onClick: () => setCurrent(0),
      current: current === 0,
    },
  ];

  const options = [
    { id: 0, label: 'open plc editor', value: 0 },
    { id: 1, label: 'lorem ipsum', value: 1 },
  ];

  return (
    <>
      <Tabs tabs={leftColumnTabs} />
      <ResizableBox
        width={Infinity}
        height={300}
        className="border-b border-gray-200 dark:border-gray-700"
        minConstraints={[Infinity, 300]}
        resizeHandles={['s']}
        axis="y"
      >
        <div className="w-full h-full relative overflow-hidden">
          <span className="absolute -bottom-20 -right-20 bg-gray-400 w-40 h-40 p-6 rounded-full dark:bg-gray-600">
            <button type="button" className="press-animated">
              <HiPlusSmall className="h-12 w-12 text-white" />
            </button>
          </span>
        </div>
      </ResizableBox>
      <div>
        <div className="flex items-center justify-center gap-2 p-2 border-b border-gray-200 dark:border-gray-700">
          <Tooltip label={t('parentInstance')}>
            <button
              type="button"
              className="press-animated flex flex-col items-center justify-center mt-2"
            >
              <div className="w-5 h-[0.125rem] -mb-1 bg-orange-400" />
              <HiArrowSmallUp className="h-8 w-8 text-orange-400" />
            </button>
          </Tooltip>
          <FormProvider {...createComboboxForm}>
            <Form.Field>
              <Form.ComboBox name="combobox" options={options} />
            </Form.Field>
          </FormProvider>

          <Tooltip label={t('debugInstance')}>
            <button className="press-animated ml-2" type="button">
              <svg
                height="24px"
                width="24px"
                version="1.1"
                id="Layer_1"
                xmlns="http://www.w3.org/2000/svg"
                xmlnsXlink="http://www.w3.org/1999/xlink"
                viewBox="0 0 512 512"
                xmlSpace="preserve"
                fill="#000000"
              >
                <g id="SVGRepo_bgCarrier" strokeWidth="0"></g>
                <g
                  id="SVGRepo_tracerCarrier"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                ></g>
                <g id="SVGRepo_iconCarrier">
                  <g>
                    <path
                      style={{ fill: '#735643' }}
                      d="M120.149,24.936C92.211,20.011,65.749,38.337,58.6,67.569C37.622,153.344,11.211,267.342,0,315.996 l15.732,7.736c0,0,37.907-164.04,59.445-252.11c4.983-20.379,23.038-33.225,42.008-29.879c4.639,0.818,9.067-2.28,9.885-6.922 C127.89,30.18,124.79,25.754,120.149,24.936z"
                    ></path>
                    <path
                      style={{ fill: '#735643' }}
                      d="M391.851,24.936c27.938-4.925,54.401,13.401,61.549,42.633 c20.978,85.775,47.388,199.774,58.6,248.428l-15.732,7.736c0,0-37.907-164.04-59.445-252.11 c-4.983-20.379-23.038-33.225-42.008-29.879c-4.639,0.818-9.067-2.28-9.885-6.922C384.11,30.18,387.21,25.754,391.851,24.936z"
                    ></path>
                  </g>
                  <g>
                    <polygon
                      style={{ fill: '#4D3A2D' }}
                      points="0,315.996 0,353.032 30.234,365.887 41.612,331.754 115.486,315.996 "
                    ></polygon>
                    <polygon
                      style={{ fill: '#4D3A2D' }}
                      points="396.514,315.996 470.388,331.754 481.766,365.887 512,353.032 512,315.996 "
                    ></polygon>
                  </g>
                  <path
                    style={{ fill: '#A0C9FF' }}
                    d="M444.551,466.755c-25.254,19.092-93.47,13.904-120.921,1.232 c-31.741-14.651-44.633-68.762-38.35-105.341c5.254-30.594,20.821-46.65,84.754-46.65c43.221,0,92.864,9.101,108.004,34.055 C494.036,376.416,466.513,450.152,444.551,466.755z"
                  ></path>
                  <path
                    style={{ fill: '#CFE4FF' }}
                    d="M387.293,316.486l-99.311,99.311c4.516,17.838,12.632,34.281,24.315,44.663l133.296-133.296 C428.685,320.985,407.877,317.652,387.293,316.486z"
                  ></path>
                  <path
                    style={{ fill: '#A0C9FF' }}
                    d="M190.002,466.755c-25.254,19.092-93.47,13.904-120.921,1.232 c-31.741-14.651-44.633-68.762-38.35-105.341c5.254-30.594,20.821-46.65,84.754-46.65c43.221,0,92.864,9.101,108.004,34.055 C239.486,376.416,211.965,450.152,190.002,466.755z"
                  ></path>
                  <path
                    style={{ fill: '#CFE4FF' }}
                    d="M132.743,316.486l-99.311,99.311c4.516,17.838,12.632,34.281,24.315,44.663l133.296-133.296 C174.136,320.985,153.328,317.652,132.743,316.486z"
                  ></path>
                  <path
                    style={{ fill: '#4D3A2D' }}
                    d="M489.678,361.202c-2.277-13.261-7.093-29.86-24.26-40.589c-14.353-8.971-36.247-13.15-68.905-13.15 c-21.553,0-93.381,2.74-115.1,37.85c-7.417-5.012-16.204-7.765-25.413-7.765s-17.996,2.753-25.413,7.765 c-21.719-35.111-93.548-37.85-115.1-37.85c-32.656,0-54.552,4.178-68.905,13.15c-17.167,10.73-21.983,27.328-24.26,40.589 c-3.418,19.897-1.472,44.178,5.202,64.948c7.799,24.27,21.288,41.879,37.981,49.585c15.958,7.366,43.121,12.126,69.201,12.126 c18.945,0,44.809-2.48,60.443-14.298c14.698-11.113,27.48-38.671,33.958-58.895c3.407-10.633,9.47-33.089,7.12-52.034 c5.283-5.13,12.31-8.02,19.773-8.02c7.464,0,14.491,2.89,19.773,8.02c-2.351,18.945,3.714,41.401,7.12,52.034 c6.478,20.224,19.26,47.783,33.958,58.895c15.633,11.818,41.498,14.298,60.443,14.298c26.079,0,53.242-4.76,69.201-12.126 c16.693-7.706,30.182-25.316,37.981-49.585C491.151,405.38,493.096,381.099,489.678,361.202z M212.854,409.461 c-7.299,22.782-18.811,43.543-27.997,50.488c-9.118,6.894-27.398,10.846-50.151,10.846c-23.436,0-48.37-4.242-62.048-10.555 c-26.532-12.247-39.578-60.863-33.517-96.149c3.979-23.164,11.784-39.562,76.345-39.562c50.14,0,89.671,11.756,100.708,29.947 C221.957,363.974,220.677,385.043,212.854,409.461z M439.342,460.24c-13.677,6.314-38.612,10.555-62.048,10.555 c-22.753,0-41.032-3.954-50.151-10.846c-9.186-6.945-20.7-27.706-27.997-50.488c-7.822-24.418-9.102-45.487-3.341-54.984 c11.038-18.192,50.567-29.947,100.708-29.947c64.561,0,72.366,16.398,76.345,39.562C478.919,399.377,465.873,447.993,439.342,460.24 z"
                  ></path>
                </g>
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
    </>
  );
};

export default LeftColumn;
