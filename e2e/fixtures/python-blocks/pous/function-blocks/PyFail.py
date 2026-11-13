FUNCTION_BLOCK PyFail
  VAR_OUTPUT
    count : DINT;
  END_VAR

from multiprocessing import shared_memory
import struct
import time
import os


def block_init():
    pass


def block_loop():
    global count
    count = count + 1
    if count >= 30:
        raise RuntimeError('planned failure after 30 loops')

END_FUNCTION_BLOCK
