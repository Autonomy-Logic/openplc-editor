PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    g1_0 : UINT AT MB_G1_0;
    g1_1 : UINT AT MB_G1_1;
    g1_2 : UINT AT MB_G1_2;
    g1_3 : UINT AT MB_G1_3;
    g1_4 : UINT AT MB_G1_4;
    g1_5 : UINT AT MB_G1_5;
    g1_6 : UINT AT MB_G1_6;
    g1_7 : UINT AT MB_G1_7;
    g1_8 : UINT AT MB_G1_8;
    g1_9 : UINT AT MB_G1_9;
    g2_0 : UINT AT MB_G2_0;
  END_VAR

scan_toggle := NOT scan_toggle;

END_PROGRAM
