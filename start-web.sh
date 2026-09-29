#!/bin/sh
# Serves the local web build (see README.md).
set -eu
cd "$(dirname "$0")"
exec python3 -m http.server 8080
