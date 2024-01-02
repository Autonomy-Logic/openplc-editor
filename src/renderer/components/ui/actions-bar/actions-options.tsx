export default function ActionsOptions({ options, setSelectedOption, selectedOptionLabel,setShowOptions }) {
  const handleOptionClick = (option) => {
    setSelectedOption(option.label);
    option.onClick();
    setShowOptions(false);
  };

  return (
    <div>
      {options.map((option) => (
        <div
          className='cursor-pointer hover:bg-gray-100 p-1'
          key={option.label}
          onClick={() => handleOptionClick(option)}
          style={{
            fontWeight: selectedOptionLabel === option.label ? 'bold' : 'normal',
          }}
        >
          {option.label}
        </div>
      ))}
    </div>
  );
}
