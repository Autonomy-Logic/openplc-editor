
export default function ConsolePanel() {
  return (
    <div className=' h-full w-full overflow-auto text-cp-base font-semibold text-brand-dark dark:text-neutral-50'>
      Start build in C:\Users\Pichau\OpenPLC_Editor\editor\examples\Blink\build Generating SoftPLC
      <br /> IEC-61131 ST/IL/SFC code...
      <br /> Collecting data types
      <br /> Collecting POUs
      <br /> Generate <span className='text-brand-medium'>POU Blink</span>
      <br /> Generate Config(s)
      <br /> Compiling IEC Program into C code...
      <br /> Extracting Located Variables...
      <br /> C code generated successfully. PLC :
      <br /> [CC] <span className='text-brand-medium'>plc_main.c - plc_main.o</span>
      <br /> [CC] <span className='text-brand-medium'>plc_debugger.c - plc_debugger.o</span>
      <br /> py_ext :
      <br /> [CC] <span className='text-brand-medium'>py_ext.c - py_ext.o</span>
      <br /> PLC :
      <br /> [CC] <span className='text-brand-medium'>Config0.c - Config0.o</span>
      <br /> [CC] <span className='text-brand-medium'>Res0.c - Res0.o</span>
      <br /> Linking :
      <br />{' '}
      <span className='text-brand-medium'>[CC] plc_main.o plc_debugger.o py_ext.o Config0.o Res0.o - Teste.dll</span>
      <br /> Successfully built.
      <br /> PYRO connecting to URI : PYROLOC://127.0.0.1:61355
      <br /> PLC did not provide identity and security infomation.
      <br /> Latest build does not match with connected target.
      <br /> PLC data transfered successfully.
      <br /> Retain size 0
      <br /> PLCobject : NewPLC (0dc7b1348468726e71ec5d51ac22ce72)
      <br /> PLC installed successfully.
      <br /> PLCobject : PLC started
      <br /> PLCobject : Python extensions started
      <br /> Starting PLC
      <br /> PLCobject : PLC stopped
    </div>
  )
}
