# Telegram channel descriptor

This public package describes one reviewed external DSH channel artifact:
`@ashafizullah/dsh-telegram@0.5.1`. It is not a Telegram client and does not
copy, wrap, or execute the plugin. The exact npm tarball digest, source
revision, provenance endpoint, DSH compatibility, required conversation
capabilities, and bounded mediation classes are fixed in the descriptor.

The transport-descriptor API is
`createTelegramChannelPluginDescriptor(runtimeKit)`. Runtime-kit remains the
canonical descriptor and digest owner. The caller supplies no artifact or
configuration values, so it cannot replace the reviewed bytes or widen the
public contract.

The same package also exports `createTelegramAudienceRouter(authorityOwner)`.
It is the public, channel-admission contract placed in front of agent dispatch;
it is not another Telegram client or authority engine. The deployment owner
resolves real Telegram updates into keyed opaque refs, authenticates the
binding, and atomically consumes its single-use assertion. The router then:

- checks exact scope, event, binding, audience-role, conversation,
  participant, and normalized mention/reply addressing correspondence;
- keeps participant authorization separate from conversation admission;
- selects `private-dm`, `group-mentioned`, or `group-free-response` behavior;
- treats both an explicit mention and a reply to the bot as group addressing;
- enforces group ambient-context maxima of seven days, 200 messages, and
  131,072 characters; and
- derives isolated session and model-route keys from opaque scope and
  conversation inputs.

The authorization result is the exported
`TelegramAudienceAuthorizationResult` union: exact denial is only
`{ allowed: false }`, while an admitted binding includes every authenticated
field in `AuthenticatedTelegramAudienceBinding`. Both branches are pinned by
`schemas/audience-binding.schema.json` and
`TELEGRAM_AUDIENCE_BINDING_SCHEMA_DIGEST`. The admitted branch binds the
normalized `mentionedBot` and `repliesToBot` booleans so caller-supplied
addressing cannot widen a mention-gated assertion. The envelope deliberately
contains no model choice: only the authenticated deployment result supplies an
opaque `modelRouteRef`, and its `modelRouteClass` must remain the profile's
public `conversation-bounded` ceiling. A missing, malformed, mismatched,
denied, already-consumed, or authority-unavailable binding returns a
fail-closed decision. A mention-gated but otherwise admitted group message
returns an `ignore` decision with only its bounded context policy, so
addressing remains distinct from access control.

The owner sets `timeoutMilliseconds` from 1 through the exported 30-second
public ceiling. One derived `AbortSignal` is propagated to both `authorize`
and `consume`; the optional signal passed to `admit` cancels that same bounded
admission. Timeout, cancellation, rejection, or a non-settling owner callback
returns `authority-unavailable`. The consumption request is the exact frozen
`TelegramAudienceConsumptionRequest` tuple of `scopeRef`, `eventRef`,
`assertionRef`, `bindingDigest`, and `admissionSealDigest`. Its public response
is exactly `TelegramAudienceConsumptionReceipt`: `{ accepted: true }` admits
once, `{ accepted: false }` reports replay, and additional or malformed fields
fail closed.

The public configuration fixes the channel at `enabled: false` and explicitly
turns off attachment ingestion, OCR, and screen capture. The companion DSH
profile also mounts the plugin with `disabled: true`. A private deployment must
independently verify and admit the exact artifact before it may supply its
credential reference, access bindings, isolated workspace, conversation-only
agent preset, and enablement patch. Those private values never enter this
descriptor, the public profile, or a public composition lock.

When admitted, the channel may use only an instance-state filesystem class,
the Telegram API network class, and a Telegram bot credential-handle class. It
requires the public `conversation.memory` and `conversation.reply`
capabilities, exposes no agent tool or skill, and grants no project workspace,
shell, or ambient network authority. DSH continues to own agents, sessions,
credentials, and the agent loop; runtime-kit owns authority intersection,
admission, lifecycle, isolation, and receipts.

The adopted transport's raw `allowFrom` and global
`requireMentionInGroups` settings are not substitutes for this contract: they
cannot prove an admitted conversation or express mixed group behavior. A
private integration must run the public router against its authenticated site
binding before agent dispatch and may narrow, but never exceed, the public
ambient-context ceiling. The public router keeps no replay database or mutable
session state; those stay with the deployment/runtime owner.

## Optional media, vision, and location contracts

The package also publishes three provider-neutral, independently selectable
action contracts for private adapters:

- `telegram.media.input` accepts a trusted, normalized single attachment or
  album containing photos, image documents, or bounded text documents;
- `telegram.vision.inspect` binds an exact ordered image-ref set to one opaque
  DSH-owned model-route ref; and
- `telegram.location.input` accepts one trusted static latitude/longitude value
  with optional bounded horizontal accuracy.

Each request and receipt repeats an opaque deployment, audience, conversation,
event, and request tuple. The caller must pass the independently trusted tuple
and the action admitted for it. Media and location additionally bind a
domain-separated digest of their normalized content; vision compares the
trusted route and ordered image refs directly. Missing context, a sibling
action, tuple substitution, changed content, reordered refs, additional
fields, accessors, and non-JSON data fail closed. Opaque refs must be minted by
the deployment owner from authenticated source data; they are not Telegram
chat, user, message, media-group, or file identifiers.

The media ceiling is 10 attachments and 10 album parts, 20 MiB per item and
20 MiB in total, 60,000 text characters across the request, a 1,024-character
caption, and images no larger than 2,000 pixels per side or 4 million pixels.
Photos are JPEG. Image documents are PNG, JPEG, WebP, or GIF. Text documents
must carry an explicit `text/*` type or one of the listed structured-text
application types; filename-extension guessing is deliberately not part of the
public boundary. Voice, audio, video, PDFs, arbitrary binary documents, and
live locations are rejected.

Vision accepts at most 10 unique attachment refs, an optional 4,096-character
instruction, 16,384 characters per result, and 32,768 result characters in
total. It accepts no provider name, model name, credential, session ID, or
filesystem path. DSH remains the model-route and session owner. The contract
declares no provider-network or subprocess authority.

The companion
[`capability-bundle.ceiling.json`](capability-bundle.ceiling.json) keeps all
three actions at `requested: false`. A private `dsh-bots` composition may
choose the corresponding descriptor only after runtime admission; selecting
one does not select either sibling or widen the existing plain conversation
profile. The existing `telegram-conversational` BotProfile therefore remains
unchanged.

`@ashafizullah/dsh-telegram@0.5.1` implements photos, supported image/text
documents, captions, and albums natively. Its public `TelegramMessage` type
does not contain location, so `telegram.location.input` is a separate mediated
adapter seam and is not described as transport-native. Its OCR implementation
executes `tesseract`; because the reviewed public subprocess ceiling is empty,
OCR remains `planned`, `requested: false`, has no action, and gains no
subprocess declaration. Screen capture remains excluded.

Use `createTelegramMediaInputPluginDescriptor`,
`createTelegramVisionPluginDescriptor`, and
`createTelegramLocationInputPluginDescriptor` with the immutable identity of
the coordinated `@sympoies/dsh-telegram-channel` release. These public
descriptors contain no host effects. The native channel continues to own its
separately reviewed Telegram API and credential-handle mediation; private
infrastructure still owns admission and actual execution.

Compatibility is exact DSH `0.1.1-rc.2`, runtime-kit contract `0.0.0`, plugin
API `1.0.0`, and Linux x64. Repository owner tests verify the external identity,
disabled composition, descriptor digest, schema digest, and public/private
boundary. The companion native fragment commits its complete npm graph and is
installed only with `npm ci --ignore-scripts`.
