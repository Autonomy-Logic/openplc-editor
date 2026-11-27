PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    fc1_0 : BOOL AT MB_FC1_0;
    fc1_1 : BOOL AT MB_FC1_1;
    fc1_2 : BOOL AT MB_FC1_2;
    fc2_0 : BOOL AT MB_FC2_0;
    fc2_1 : BOOL AT MB_FC2_1;
    fc3_0 : UINT AT MB_FC3_0;
    fc3_3 : UINT AT MB_FC3_3;
    fc4_0 : UINT AT MB_FC4_0;
    fc4_1 : UINT AT MB_FC4_1;
    fc5_0 : BOOL AT MB_FC5_0;
    fc6_0 : UINT AT MB_FC6_0;
    fc15_0 : BOOL AT MB_FC15_0;
    fc15_1 : BOOL AT MB_FC15_1;
    fc15_2 : BOOL AT MB_FC15_2;
    fc16_0 : UINT AT MB_FC16_0;
    fc16_1 : UINT AT MB_FC16_1;
    back5_0 : BOOL AT MB_BACK5_0;
    back6_0 : UINT AT MB_BACK6_0;
    back15_0 : BOOL AT MB_BACK15_0;
    back15_1 : BOOL AT MB_BACK15_1;
    back15_2 : BOOL AT MB_BACK15_2;
    back16_0 : UINT AT MB_BACK16_0;
    back16_1 : UINT AT MB_BACK16_1;
    scans : UINT;
    step : UINT;
  END_VAR

scan_toggle := NOT scan_toggle;
scans := scans + 1;
IF scans >= 50 THEN
  scans := 0;
  step := step + 1;
END_IF;
fc5_0 := (step MOD 2) = 1;
fc6_0 := step;
fc15_0 := (step MOD 2) = 1;
fc15_1 := (step MOD 4) >= 2;
fc15_2 := (step MOD 8) >= 4;
fc16_0 := step + 1000;
fc16_1 := step + 2000;

END_PROGRAM
