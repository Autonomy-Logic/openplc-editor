import { MagnifierIcon } from '@root/renderer/assets'
import { InputWithRef } from '@root/renderer/components/_atoms'
import { LibraryFile, LibraryFolder, LibraryRoot } from '@root/renderer/components/_molecules'
import { useOpenPLCStore } from '@root/renderer/store'
import { useState } from 'react'

export const ModalBlockLibrary = () => {
  const {
    libraries: { system },
  } = useOpenPLCStore()

  const [filterText, setFilterText] = useState('')
  const [selectedFileKey, setSelectedFileKey] = useState<string | null>(null)

  const filteredLibraries = system.filter((library) =>
    library.pous.some((pou) => pou.name.toLowerCase().includes(filterText)),
  )

  const handleFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFilterText(e.target.value.toLowerCase())
  }

  const inputStyle =
    'border dark:bg-neutral-900 dark:text-neutral-100 dark:border-neutral-850 h-[30px] w-full rounded-lg border-neutral-300 px-[10px] text-xs text-neutral-700 outline-none focus:border-brand'

  return (
    <>
      <div className={`relative flex items-center focus-within:border-brand ${inputStyle}`}>
        <InputWithRef
          className='h-full w-full bg-inherit outline-none'
          id='Search-File'
          placeholder='Search'
          type='text'
          value={filterText}
          onChange={handleFilterChange}
        />
        <label className='relative right-0 stroke-brand' htmlFor='Search-File'>
          <MagnifierIcon size='sm' className='stroke-brand' />
        </label>
      </div>
      <div className='border-neural-100 h-[388px] w-full rounded-lg border px-1 py-4 dark:border-neutral-850'>
        <div className='h-full w-full overflow-auto'>
          <LibraryRoot>
            {filteredLibraries.map((library) => (
              <LibraryFolder
                key={library.name}
                label={library.name}
                initiallyOpen={false}
                shouldBeOpen={filterText.length > 0}
              >
                {library.pous
                  .filter((pou) => pou.name.toLowerCase().includes(filterText))
                  .map((pou) => (
                    <LibraryFile
                      key={pou.name}
                      label={pou.name}
                      isSelected={selectedFileKey === pou.name}
                      onSelect={() => setSelectedFileKey(pou.name)}
                      onClick={() => {
                        setSelectedFileKey(pou.name)
                      }}
                    />
                  ))}
              </LibraryFolder>
            ))}
          </LibraryRoot>
        </div>
      </div>
    </>
  )
}
