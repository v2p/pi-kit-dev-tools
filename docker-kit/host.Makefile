# Host-only helpers for Docker Sandbox browser-tools workflows.
# Run this Makefile on the Docker host, not inside the sandbox/container.

SHELL := /bin/bash
HOST_TOOLS_DIR := $(dir $(abspath $(lastword $(MAKEFILE_LIST))))host

CHROME_DEBUG_PORT ?= 9222
CHROME_DEBUG_ADDRESS ?= 0.0.0.0
CHROME_USER_DATA_DIR ?= /tmp/pi-browser-tools-chrome-profile
CHROME_URL ?= about:blank
CHROME_EXTRA_FLAGS ?=
CDP_RELAY_PORT ?= 9223
CDP_RELAY_ADDRESS ?= 0.0.0.0
CHROME_DEBUG_HOST ?= 127.0.0.1

.PHONY: help chrome-debug cdp-relay

help:
	@printf '%s\n' \
		'Host-only Docker Sandbox browser-tools targets:' \
		'  chrome-debug  Start host Chrome with CDP remote debugging enabled' \
		'  cdp-relay     Expose CDP through a Host-header rewriting relay' \
		'' \
		'Common overrides:' \
		'  CHROME_DEBUG_PORT=9222' \
		'  CHROME_DEBUG_ADDRESS=0.0.0.0' \
		'  CHROME_DEBUG_HOST=127.0.0.1' \
		'  CHROME_USER_DATA_DIR=/tmp/pi-browser-tools-chrome-profile' \
		'  CHROME_BIN=/path/to/google-chrome' \
		'  CHROME_URL=https://example.com' \
		'  CDP_RELAY_PORT=9223' \
		'' \
		'Examples:' \
		'  make -f docker-kit/host.Makefile chrome-debug' \
		'  make -f docker-kit/host.Makefile cdp-relay' \
		'  make -f /path/to/pi-browser-tools-kit/host.Makefile chrome-debug'

chrome-debug:
	@CHROME_DEBUG_PORT="$(CHROME_DEBUG_PORT)" \
	CHROME_DEBUG_ADDRESS="$(CHROME_DEBUG_ADDRESS)" \
	CHROME_USER_DATA_DIR="$(CHROME_USER_DATA_DIR)" \
	CHROME_URL="$(CHROME_URL)" \
	CHROME_EXTRA_FLAGS="$(CHROME_EXTRA_FLAGS)" \
	CHROME_BIN="$(CHROME_BIN)" \
	"$(HOST_TOOLS_DIR)/start-chrome-debug.sh"

cdp-relay:
	@CDP_RELAY_PORT="$(CDP_RELAY_PORT)" \
	CDP_RELAY_ADDRESS="$(CDP_RELAY_ADDRESS)" \
	CHROME_DEBUG_PORT="$(CHROME_DEBUG_PORT)" \
	CHROME_DEBUG_HOST="$(CHROME_DEBUG_HOST)" \
	node "$(HOST_TOOLS_DIR)/cdp-relay.js"
