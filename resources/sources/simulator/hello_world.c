#include <stdio.h>
#include <emscripten.h>


EMSCRIPTEN_KEEPALIVE
void hello_world() {
    printf("Hello World from OpenPLC Simulator!\n");
}

EMSCRIPTEN_KEEPALIVE
int get_version() {
    return 1;
}

int main() {
    printf("OpenPLC Simulator initialized\n");
    hello_world();
    return 0;
}
