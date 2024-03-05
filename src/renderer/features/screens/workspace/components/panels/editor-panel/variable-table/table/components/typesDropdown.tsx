import React, { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";

export default function DropdownTypes({ row, value }) {
  const optionsToShow = row[value];
  const [selectedOption, setSelectedOption] = useState();
  const [hoveredName, setHoveredName] = useState(null);

  const handleSelectOption = (option) => {
    setSelectedOption(option);
    setHoveredName(null);
  };

  const handleMouseEnter = (option) => {
    setHoveredName(option.name);
  };

  //submenu
  const renderSubContent = (option) => {
    if (option.name === hoveredName && option.value.length > 0) {
      return (
        <DropdownMenu.Portal>
          <DropdownMenu.SubContent
            sideOffset={2}
            alignOffset={-1}
            className="z-50 min-w-[220px] bg-white border border-neutral-300 text-neutral-400 font-medium text-xs"
          >
            {option.value.map((subItem, subIndex) => (
              <DropdownMenu.Item
                key={subIndex}
                onClick={() => handleSelectOption(subItem)}
                className={`hover:bg-neutral-100 w-full focus:outline-none p-1
              `}
              >
                {subItem}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.SubContent>
        </DropdownMenu.Portal>
      );
    }
    return null;
  };

  
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className="w-full h-full items-center justify-center bg-inherit focus:outline-none"
          aria-label="Customise options"
        >
          {selectedOption || <p></p>}
        </button>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className="z-50 min-w-[180px] bg-white rounded-sm border border-neutral-300 text-neutral-400 font-medium text-xs"
          align="start"
        >
          {optionsToShow.map((option, index) => (
           
            <DropdownMenu.Sub key={index}>
              <DropdownMenu.SubTrigger
                onMouseEnter={() => handleMouseEnter(option)}
                onClick={() => {
                  if (option.value.length === 0) {
                    handleSelectOption(option.name);
                  }
                }}
                className={`hover:bg-neutral-100  focus:outline-none capitalize w-full h-full`}
              >
                {option.value.length === 0 ? (
                  <DropdownMenu.Item className="w-full h-full p-1">{option.name}</DropdownMenu.Item>
                ) : (
                  <p className="w-full h-full p-1">{option.name}</p>
                )}
              </DropdownMenu.SubTrigger>
              {renderSubContent(option)}
            </DropdownMenu.Sub>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
