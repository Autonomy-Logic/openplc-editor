import { Combobox } from '@headlessui/react';
import { CheckIcon, ChevronUpDownIcon } from '@heroicons/react/20/solid';
import { useState } from 'react';

import { classNames } from '@/utils';

export type ComboBoxOption = {
  id: number | string;
  label: string;
  value: number | string;
};

export type ComboBoxProps = {
  options: ComboBoxOption[];
  label?: string;
  setSelected: (value: ComboBoxOption) => void;
  selected: ComboBoxOption;
};

const ComboBox: React.FC<ComboBoxProps> = ({ options, label, selected, setSelected }) => {
  const [query, setQuery] = useState('');

  const filteredList =
    query === ''
      ? options
      : options.filter(({ label }) => label.toLowerCase().includes(query.toLowerCase()));

  return (
    <Combobox className="w-full" as="div" value={selected} onChange={setSelected}>
      {label && (
        <Combobox.Label className="block text-sm font-medium leading-6 text-gray-900 mb-2 dark:text-gray-50">
          {label}
        </Combobox.Label>
      )}
      <div className="relative w-full">
        <Combobox.Input
          className="w-full rounded-md border-0 bg-white py-1.5 pl-3 pr-10 text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 focus:ring-2 focus:ring-inset focus:ring-open-plc-blue sm:text-sm sm:leading-6 dark:bg-gray-800 dark:ring-open-plc-blue dark:text-gray-50"
          onChange={(event) => setQuery(event.target.value)}
          displayValue={(value: ComboBoxOption) => value?.label}
        />
        <Combobox.Button className="absolute inset-y-0 right-0 flex items-center rounded-r-md px-2 focus:outline-none">
          <ChevronUpDownIcon className="h-5 w-5 text-gray-400" aria-hidden="true" />
        </Combobox.Button>

        {filteredList.length > 0 && (
          <Combobox.Options className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none sm:text-sm dark:bg-gray-800">
            {filteredList.map((option) => (
              <Combobox.Option
                key={option.id}
                value={option}
                className={({ active }) =>
                  classNames(
                    'relative cursor-default select-none py-2 pl-3 pr-9',
                    active
                      ? 'bg-open-plc-blue text-white'
                      : 'text-gray-900 dark:text-gray-50',
                  )
                }
              >
                {({ active, selected }) => (
                  <>
                    <span
                      className={classNames(
                        'block truncate',
                        selected && 'font-semibold',
                      )}
                    >
                      {option.label}
                    </span>

                    {selected && (
                      <span
                        className={classNames(
                          'absolute inset-y-0 right-0 flex items-center pr-4',
                          active ? 'text-white' : 'text-open-plc-blue',
                        )}
                      >
                        <CheckIcon className="h-5 w-5" aria-hidden="true" />
                      </span>
                    )}
                  </>
                )}
              </Combobox.Option>
            ))}
          </Combobox.Options>
        )}
      </div>
    </Combobox>
  );
};

export default ComboBox;
