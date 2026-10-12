# Windows installer branding

`header.bmp` (150×57) and `sidebar.bmp` (164×314) are opaque, uncompressed
24-bit BMPs derived from `assets/icon.png`. Regenerate with locked dependencies:

```sh
node scripts/generate-windows-installer-brand.mjs
```

`src/windows-installer-brand.test.ts` compares committed bytes with that exact
generator. Each desktop workflow already runs `tauri icon assets/icon.png`,
which prepares the shared `icons/icon.ico`; `tauri.conf.json` explicitly selects
that icon for NSIS installation and uninstallation and these page bitmaps.
Do not edit the locked vendor installer template to add branding.

The independent Docker suite is `tests/windows-installer-brand/Dockerfile`:
run the `core` target before `compile`. The latter compiles the complete locked
template using an inert payload and the real NSIS compiler, without installing it.
It produces TEST ONLY bytes, never a public release or model/login proof.

Recovery/change boundaries: no resident service, startup launcher, port, proxy,
tunnel, secret source, account storage, install directory or upgrade identity is
changed. Builds use this repository's assets/config/template/lockfiles and the
existing exact-main desktop release SOP (`docs/desktop-release-sop.md`). Verify
the next native signed installer visibly uses the logo before recording visual
acceptance. Roll back this branding config/assets change or use the previous
published client through the documented release rollback process. User account
data still requires its existing data backups; Git assets do not restore it.
