PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    big_0 : UINT AT MB_BIG_0;
    big_1 : UINT AT MB_BIG_1;
    big_60 : UINT AT MB_BIG_60;
    big_61 : UINT AT MB_BIG_61;
    big_62 : UINT AT MB_BIG_62;
    big_123 : UINT AT MB_BIG_123;
    big_124 : UINT AT MB_BIG_124;
  END_VAR

scan_toggle := NOT scan_toggle;

END_PROGRAM
