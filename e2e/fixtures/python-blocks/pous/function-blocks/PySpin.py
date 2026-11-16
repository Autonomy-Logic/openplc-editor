FUNCTION_BLOCK PySpin
  VAR_OUTPUT
    entered : DINT;
  END_VAR

from multiprocessing import shared_memory
import struct
import time
import os


def block_init():
    pass


def block_loop():
    global entered
    entered = 1
    while True:
        pass

END_FUNCTION_BLOCK
