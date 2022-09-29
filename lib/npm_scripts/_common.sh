#!/bin/bash
set -euo pipefail

cd "$(dirname "$0")" # cd to where we are now
cd ../.. # get to repo root

default_app_name=klotho-slack-notifier-bot
if [[ -z "${KLOTHO_APP_NAME:-}" ]]; then
  export KLOTHO_APP_NAME="$default_app_name"
fi

if [[ "$KLOTHO_APP_NAME" == "$default_app_name" ]]; then
  KLOTHO_OUT_DIR=compiled
else
  KLOTHO_OUT_DIR="compiled-klotho/$KLOTHO_APP_NAME"
fi
export KLOTHO_OUT_DIR
