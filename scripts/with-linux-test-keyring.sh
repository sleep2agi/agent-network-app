#!/bin/sh
# CI/test-only: use in an isolated Docker user session, never a live desktop.
set -eu
if [ "${ANET_ISOLATED_KEYRING_TEST:-}" != "1" ]; then
  echo 'Refusing to unlock a keyring outside an explicitly isolated test session' >&2
  exit 2
fi
exec dbus-run-session -- sh -eu -c '
  export GNOME_KEYRING_CONTROL="$(mktemp -d)"
  mkdir -p "$HOME/.local/share/keyrings"
  printf "%s" "dummy-keyring-password" | gnome-keyring-daemon --unlock --components=secrets --control-directory "$GNOME_KEYRING_CONTROL"
  # --unlock returns before this daemon owns org.freedesktop.secrets. If the
  # app starts in that window, dbus activates a second daemon, which then
  # reads a half-written login.keyring ("invalid or unrecognized format") and
  # Secret Service answers "no result found".
  i=0
  while [ "$i" -lt 50 ]; do
    if dbus-send --session --dest=org.freedesktop.DBus --type=method_call --print-reply /org/freedesktop/DBus org.freedesktop.DBus.NameHasOwner string:org.freedesktop.secrets 2>/dev/null | grep -q "boolean true"; then
      break
    fi
    i=$((i + 1))
    sleep 0.1
  done
  exec "$@"
' sh "$@"
