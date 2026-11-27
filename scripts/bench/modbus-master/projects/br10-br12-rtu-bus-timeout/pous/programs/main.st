PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    present_0 : UINT AT MB_PRESENT_0;
    present_1 : UINT AT MB_PRESENT_1;
    absent_0 : UINT AT MB_ABSENT_0;
  END_VAR

scan_toggle := NOT scan_toggle;

END_PROGRAM
