#!/bin/sh
# CI/test-only: use in an isolated Docker user session, never a live desktop.
set -eu
if [ "${ANET_ISOLATED_KEYRING_TEST:-}" != "1" ]; then
  echo 'Refusing to unlock a keyring outside an explicitly isolated test session' >&2
  exit 2
fi
exec dbus-run-session -- sh -eu -c '
  export GNOME_KEYRING_CONTROL="$(mktemp -d)"
  printf "%s" "dummy-keyring-password" | gnome-keyring-daemon --unlock --components=secrets --control-directory "$GNOME_KEYRING_CONTROL"
  exec "$@"
' sh "$@"
