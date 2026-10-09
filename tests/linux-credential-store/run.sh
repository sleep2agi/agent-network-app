#!/bin/sh
set -eu
probe=/probe/target/release/anet-linux-credential-store
# No session bus: fail closed instead of a successful mock write.
DBUS_SESSION_BUS_ADDRESS=unix:path=/tmp/anet-no-session-bus "$probe" unavailable
dbus-run-session -- sh -eu -c '
  mkdir -p "$HOME/.local/share/keyrings"
  export GNOME_KEYRING_CONTROL="$(mktemp -d)"
  printf "%s" "dummy-keyring-password" | gnome-keyring-daemon --unlock --components=secrets --control-directory "$GNOME_KEYRING_CONTROL"
  /probe/target/release/anet-linux-credential-store missing
  /probe/target/release/anet-linux-credential-store write
  /probe/target/release/anet-linux-credential-store read
'
# Restart both the session bus and service; keep only the fixture user's disk data.
dbus-run-session -- sh -eu -c '
  export GNOME_KEYRING_CONTROL="$(mktemp -d)"
  printf "%s" "dummy-keyring-password" | gnome-keyring-daemon --unlock --components=secrets --control-directory "$GNOME_KEYRING_CONTROL"
  /probe/target/release/anet-linux-credential-store read
  dbus-send --session --print-reply --dest=org.freedesktop.secrets \
    /org/freedesktop/secrets org.freedesktop.Secret.Service.Lock \
    array:objpath:/org/freedesktop/secrets/collection/login
  timeout 20 /probe/target/release/anet-linux-credential-store unavailable
'
# A fresh, explicitly unlocked session must recover the unchanged stored item.
# --unlock on an already-running locked daemon is not a portable unlock UI.
dbus-run-session -- sh -eu -c '
  export GNOME_KEYRING_CONTROL="$(mktemp -d)"
  printf "%s" "dummy-keyring-password" | gnome-keyring-daemon --unlock --components=secrets --control-directory "$GNOME_KEYRING_CONTROL"
  /probe/target/release/anet-linux-credential-store read
  /probe/target/release/anet-linux-credential-store delete
  /probe/target/release/anet-linux-credential-store missing
'
echo 'PASS real Secret Service cross-Entry / cross-process / session restart / delete / missing-bus / locked-store'
