PROGRAM main
  VAR
    scan_toggle : BOOL AT %QX0.0;
    reg_out : UINT AT %QW0;
    holding_in : UINT AT %IW0;
    step : UINT;
  END_VAR

scan_toggle := NOT scan_toggle;
step := step + 1;
reg_out := step + holding_in;

END_PROGRAM
