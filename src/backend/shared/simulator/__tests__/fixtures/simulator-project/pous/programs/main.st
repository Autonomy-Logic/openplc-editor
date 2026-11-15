PROGRAM main
  VAR
    counter : DINT;
    timer : TON;
    fired : BOOL;
    fired_at_scan : DINT;
    force_me : BOOL;
    mirror : BOOL;
    big : ARRAY[0..19999] OF DINT;
    out_q : BOOL AT %QX0.0;
    in_w : INT AT %IW0;
    in_copy : INT;
  END_VAR
  VAR RETAIN
    kept : DINT;
  END_VAR

counter := counter + 1;
kept := kept + 1;
big[counter MOD 20000] := counter;
timer(IN := TRUE, PT := T#1s);
IF timer.Q AND NOT fired THEN
  fired := TRUE;
  fired_at_scan := counter;
END_IF;
mirror := force_me;
out_q := force_me;
in_copy := in_w;

END_PROGRAM
