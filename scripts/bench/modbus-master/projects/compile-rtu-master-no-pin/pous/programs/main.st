PROGRAM main
  VAR
    scan_toggle : BOOL;
    coil_0 : BOOL AT %IX0.0;
    discrete_0 : BOOL AT %IX0.3;
    holding_0 : UINT AT %IW0;
    input_0 : UINT AT %IW4;
    coil_out : BOOL AT %QX0.0;
    reg_out : UINT AT %QW0;
    coils_out_0 : BOOL AT %QX0.1;
    regs_out_0 : UINT AT %QW1;
    second_0 : UINT AT %IW6;
    step : UINT;
  END_VAR

scan_toggle := NOT scan_toggle;
step := step + 1;
coil_out := scan_toggle;
reg_out := step;
coils_out_0 := NOT scan_toggle;
regs_out_0 := holding_0 + input_0 + second_0;

END_PROGRAM
