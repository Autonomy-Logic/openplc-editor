PROGRAM main
  VAR
    counter : DINT;
    pulses : DINT;
    t : TON;
    c : CTU;
    d : UserDelay;
    tick : BOOL;
  END_VAR

counter := counter + 1;
tick := NOT tick;
t(IN := NOT t.Q, PT := T#40ms);
c(CU := t.Q, PV := 1000);
d(IN := NOT d.Q);
pulses := d.COUNT;

END_PROGRAM
