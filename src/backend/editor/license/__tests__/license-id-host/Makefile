# Host tests for the Baremetal board-ID layer. Usage: make OUT=<dir> check
CC      ?= cc
OUT     ?= build
SRC      = ../../../../../../resources/sources/Baremetal

CFLAGS = -std=c11 -Wall -Wextra -Werror -O2 -I . -I $(SRC)

TESTS = id_report
BINS  = $(addprefix $(OUT)/,$(addsuffix _host_test,$(TESTS)))

.PHONY: all check clean
all: $(BINS)

$(OUT):
	mkdir -p $@

$(OUT)/%.o: $(SRC)/%.c | $(OUT)
	$(CC) $(CFLAGS) -c $< -o $@

$(OUT)/%.o: %.c | $(OUT)
	$(CC) $(CFLAGS) -c $< -o $@

$(OUT)/id_report_host_test: $(OUT)/license_platform.o $(OUT)/id_report_host_test.o
	$(CC) $(CFLAGS) -o $@ $^

check: $(BINS)
	set -e; cd $(OUT); for t in $(TESTS); do ./$${t}_host_test; done

clean:
	rm -rf $(OUT)
