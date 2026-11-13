PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    g1_0 : UINT AT MB_G1_0;
    g1_1 : UINT AT MB_G1_1;
    s7_word : UINT AT %QW0;
  END_VAR

scan_toggle := NOT scan_toggle;
s7_word := 4242;

END_PROGRAM
