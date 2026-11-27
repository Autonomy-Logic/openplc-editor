PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    g1_0 : UINT AT MB_G1_0;
    g1_1 : UINT AT MB_G1_1;
  END_VAR

scan_toggle := NOT scan_toggle;

END_PROGRAM
