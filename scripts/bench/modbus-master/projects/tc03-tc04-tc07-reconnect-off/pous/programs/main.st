PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    zero_0 : UINT AT MB_ZERO_0;
    zero_1 : UINT AT MB_ZERO_1;
    keep_0 : UINT AT MB_KEEP_0;
    keep_1 : UINT AT MB_KEEP_1;
  END_VAR

scan_toggle := NOT scan_toggle;

END_PROGRAM
