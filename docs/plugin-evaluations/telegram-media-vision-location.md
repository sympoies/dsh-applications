# Telegram media, vision, and location

- Date: 2026-09-08
- Author: maintainer session (evaluate-dsh-plugin skill)
- Decision: adopt

## 2026-09-10 follow-up: native vision before additional routers

The adoption decision remains unchanged: use the pinned Telegram transport and
the selected model's native image input when supported. First verify attachment
download, normalization, storage, and model delivery independently; a storage
failure before model invocation is not evidence that another vision provider
is needed.

An npm `dsh vision` survey found `dsh-vision-router@2.1.4` (MIT; published
2026-09-08; 59,866 downloads for 2026-08-08 through 2026-09-06, observed
2026-09-10) and `dsh-vision-recognizer@0.2.0` (MIT; published 2026-08-21;
1,453 downloads over the same period). The router's documented anonymous
fallback chain and screenshot/browser scope need explicit authority; popularity
is not sufficient to forward images to additional services.

Recognizer's exact readable tarball SHA-256 is
`6df013a533aeb45a45b2d04079590e138e7967fbea4d6689dd98d01ee082a792`.
It has one dependency, `schemastery ^3.18.0`, no declared peers, and no
install/postinstall script. Its native multimodal pass-through is relevant,
but it also defaults to local Ollama discovery and persists provider/key
configuration separately. It passed the locked 0.1.1-rc.2 disabled probe after
removal of its self-registering bundle row. No provider was invoked.
Do not adopt this additional router for a native-image-capable route.

References: [router](https://github.com/ysr666/dsh-vision-router),
[recognizer](https://github.com/kaixinbaba/dsh-vision-recognizer).

## Survey

The broader Telegram transport survey and exact locked-DSH probes are retained
in [Telegram channel](telegram-channel.md). This capability follow-up
re-inspected the exact adopted tarball rather than reopening transport
selection: `@ashafizullah/dsh-telegram@0.5.1`, npm integrity
`sha512-/bFEveB+vafAFoM2MW6vTCTPEHBMDnblAfKaFIs221Jh27cvfFrtHyhwi5vzxByqeoqMN/g/2I23+gI4NU1lLg==`
and tarball SHA-256
`a41aa5300eb0b0a25b33c162e843955eac8450c8a71446ba5c7f68623b61ea4b`.
It remains the only selected transport candidate because issue #28 changes no
transport requirement or compatibility line.

| Package | Version | License | Last publish | Repository |
| ------- | ------- | ------- | ------------ | ---------- |
| `@ashafizullah/dsh-telegram` | 0.5.1 | MIT | 2026-08-21 | github.com/ashafizullah/dsh-telegram |

## Evaluation

The published tarball is readable, has no install lifecycle script, and retains
the exact source revision and provenance recorded by the channel evaluation.
Inspection of `lib/telegram/types.d.ts`, `lib/media/intake.js`,
`lib/media/collect.d.ts`, `lib/telegram/albums.js`, `lib/media/vision.d.ts`, and
`lib/media/ocr.js` established these boundaries:

- photos become JPEG image candidates; image documents accept PNG, JPEG, WebP,
  and GIF;
- documents carrying `text/*` or the plugin's enumerated structured-text
  application types are read as text, while voice, audio, and video are
  explicitly classified unsupported;
- captions are retained and a shared media-group is gathered into one ordered
  album, capped by the transport at 10 parts;
- the configured transport download ceiling defaults to 20 MiB and inline text
  defaults to 60,000 characters;
- model vision is checked against the active model route and may use a
  one-turn extraction session; and
- OCR imports `execFile` and invokes `tesseract`, while screenshot capture also
  invokes an OS subprocess.

The public `TelegramMessage` declaration contains no `location` member.
Consequently location cannot be claimed as native support in this artifact.
It needs a separate authenticated adapter seam that emits only a bounded static
coordinate value and opaque deployment-scoped refs.

## Probe results

The exact `0.5.1` tarball was fetched with lifecycle scripts disabled and its
SHA-256 matched the existing lock. The prior clean throwaway DSH_HOME probe in
[Telegram channel](telegram-channel.md) remains applicable: exact DSH
`0.1.1-rc.2` installs the candidate, it stays absent after add-time bundle
registration is removed, and an explicit insert row mounts it disabled.

The capability inspection does not execute media, OCR, screen capture, or a
real Telegram update. That would require credential, provider, filesystem, or
subprocess authority outside a public plugin evaluation. Instead, owner tests
exercise the normalized public request/receipt contracts and exact runtime-kit
descriptor validation without such authority.

## Decision

**Adopt `@ashafizullah/dsh-telegram@0.5.1` unchanged for its verified photo,
allowed image/text document, caption, album, and vision-input surfaces.** Keep
the artifact identity and native mount exactly pinned and disabled by default.
Publish narrower public media and vision mediation contracts beside it, with
independent action IDs and no credential, provider name, transport identifier,
path, network, or subprocess authority.

Publish location only as a separately mediated public input contract implemented
by the downstream adapter from an authenticated update. This is not an adopted
transport feature: the exact artifact has no location field. Static latitude,
longitude, and optional horizontal accuracy are allowed; live-period state and
transport identifiers are rejected.

Do not adopt the artifact's OCR execution under the current ceiling. It remains
planned and disabled because `tesseract` requires subprocess and temporary-file
authority that this public contract does not declare. Screen capture, voice,
audio, video, arbitrary files, and an independent agent loop remain excluded.
