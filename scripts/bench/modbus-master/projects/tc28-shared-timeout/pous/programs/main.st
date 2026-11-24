PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    a_0 : UINT AT MB_A_0;
    a_1 : UINT AT MB_A_1;
    b_0 : UINT AT MB_B_0;
    b_1 : UINT AT MB_B_1;
  END_VAR

scan_toggle := NOT scan_toggle;

END_PROGRAM
