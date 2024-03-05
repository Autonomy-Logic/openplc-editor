import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

export default function DropdownTypes({ row }) {
  console.log(row);

  const [hoveredName, setHoveredName] = useState(null);
  const [selectedType, setSelectedType] = useState(null);

  const handleSelectType = (type) => {
    setSelectedType(type);
    setHoveredName(null);
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger className="w-full cursor-pointer h-full items-center justify-center bg-inherit focus:outline-none">
        <button aria-label="Customise options">
          {selectedType ? selectedType : <p></p>}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Content
        className="z-50 hover:scale-105 cursor-pointer  transition-all duration-100 w-[var(--radix-popper-anchor-width)] bg-white rounded-sm border border-neutral-300 text-neutral-400 font-medium text-xs"
        align="start"
      >
        {row.type.map((type) => (
          <DropdownMenu.Sub key={type.name}>
            <DropdownMenu.SubTrigger
              onMouseEnter={() => setHoveredName(type.name)}
              className="focus:outline-none  hover:bg-neutral-100 p-1  w-full h-full"
            >
              {type.name}
            </DropdownMenu.SubTrigger>

            {type.value.length > 0 && hoveredName === type.name && (
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent
                  sideOffset={-4}
                  alignOffset={-1}
                  className="z-50 cursor-pointer transition-all duration-100 hover:scale-105 w-36 bg-white rounded-sm border border-neutral-300 text-neutral-400 font-medium text-xs"
                >
                  {type.value.map((option) => (
                    <DropdownMenu.Item
                      key={option}
                      onClick={() => handleSelectType(option)}
                      className="hover:bg-neutral-100  w-full focus:outline-none p-1"
                    >
                      {option}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            )}
          </DropdownMenu.Sub>
        ))}
      </DropdownMenu.Content>
    </DropdownMenu.Root>
  );
}
