# Native DSH composition

This directory is a portable DSH profile fragment for the exact DSH version
recorded in the repository compatibility lock.

From this directory, install the committed dependency graph with
`npm ci --ignore-scripts`, then point DSH at the containing profile directory.
The nested `package-lock.json` is part of the public artifact contract: it
binds the selected plugin's reviewed npm integrity and every transitive
dependency used by a clean install. Do not substitute `npm install`, and do
not use `dsh plugin add` or `dsh plugin install`: those commands can resolve a
different graph or register the upstream Telegram bundle, bypassing this
composition's explicit disabled insert. The committed `dsh.profile.bundles`
list deliberately contains only the DSH base and headless bundles.

`cordis.patch.yml` is the sole Telegram mount. It remains disabled, and its
public defaults also turn off attachment ingestion, OCR, and screen capture.
Private admission must verify the locked artifact, provide a credential handle,
access policy, isolated workspace, and conversation-only agent preset, then
explicitly authorize enablement before deployment.
