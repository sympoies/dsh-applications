# Native DSH composition

This directory is a portable DSH profile fragment for the exact DSH version
recorded in the repository compatibility lock.

Install its exact dependencies with lifecycle scripts disabled, then point DSH
at the containing profile directory. Do not use `dsh plugin add` or `dsh plugin
install` as the installation step: those commands register the upstream
Telegram bundle and would bypass this composition's explicit disabled insert.
The committed `dsh.profile.bundles` list deliberately contains only the DSH
base and headless bundles.

`cordis.patch.yml` is the sole Telegram mount. It remains disabled, and its
public defaults also turn off attachment ingestion, OCR, and screen capture.
Private admission must verify the locked artifact, provide a credential handle,
access policy, isolated workspace, and conversation-only agent preset, then
explicitly authorize enablement before deployment.
