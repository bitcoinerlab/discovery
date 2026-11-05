#!/usr/bin/env bash
set -euo pipefail

child_pid=''

cleanup() {
  local status=$?
  trap - EXIT
  trap '' INT TERM
  if [[ -n "$child_pid" ]]; then
    kill "$child_pid" 2>/dev/null || true
    wait "$child_pid" 2>/dev/null || true
  fi
  if ! npm run --silent cleanTmpTester; then
    if (( status == 0 )); then status=1; fi
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

run_child() {
  local status=0
  "$@" &
  child_pid=$!
  wait "$child_pid" || status=$?
  child_pid=''
  return "$status"
}

npm run cleanTmpTester
npm run ensureTmpTester
export APIURL=http://127.0.0.1:18080/1
export APIPASS=satoshi
export ESPLORA_URL=http://127.0.0.1:13002
export ELECTRUM_PORT=16401

run_child node scripts/wait-for-tape.cjs
run_child node --require ./test/local-network.cjs ./node_modules/jest/bin/jest.js --runInBand "$@"
