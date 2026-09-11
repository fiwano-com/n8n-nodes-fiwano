# n8n-nodes-fiwano

n8n verified community node for **[Fiwano](https://fiwano.com)** — a unified messaging API for **WhatsApp, Instagram DM, and Facebook Messenger**.

## What is Fiwano?

Fiwano is a verified Meta Tech Provider that abstracts the complexity of WhatsApp Cloud API, Instagram Messaging API, and Facebook Messenger API into a single, consistent REST API. Connect your Meta-verified business accounts once via simple Facebook auth — no Meta developer portal, no app creation, no Meta app review.

**Fiwano is a messaging API, not a full Meta platform API.** It does one thing well: receive inbound messages and send replies (plus WhatsApp templates) across WhatsApp, Instagram DM, and Messenger. It deliberately stays out of comments, posts, stories, ads, and page analytics — just conversations with people.

Key benefits:
- **Official Meta APIs only** — built on WhatsApp Cloud API, Instagram Messaging API and Facebook Messenger API. No browser automation, no unofficial client simulation, no account ban risk. Production-safe at any scale.
- **One API for three channels** — identical request format across WhatsApp, Instagram DM, and Facebook Messenger
- **Real-time webhooks** — incoming messages and delivery statuses delivered to your endpoint, HMAC-signed
- **WhatsApp template management** — create, manage, and send approved templates directly from the API
- **Secure by default** — tokens encrypted at rest, no message content stored on Fiwano's side

Built for AI assistants, CRMs, helpdesks, and any product that needs conversational messaging at business scale.

**[7-day free trial](https://fiwano.com/auth/login) — no credit card required.**

## License Tiers

One license covers a slot bundle: **1 WhatsApp + 1 Instagram + 1 Facebook Messenger** channel, with unlimited messages.

| Tier | Monthly | Capabilities |
|------|---------|-------------|
| Starter | $12 | Text messages in/out and delivery statuses |
| Pro | $19 | Everything in Starter + inbound media and files, outbound media via HTTPS URL (signed URLs supported), WhatsApp template management and sending |

New accounts start with a **7-day free trial on the Pro tier** (full functionality).

## Nodes

| Node | Type | Description |
|------|------|-------------|
| **Fiwano** | Action | Send messages, manage channels, check subscriptions and available slots, WhatsApp templates, contact profile enrichment, redirect URIs |
| **Fiwano Trigger** | Webhook Trigger | Receive incoming messages and delivery status webhooks |

### Action node — operations

| Resource | Operations |
|----------|-----------|
| Message | Send Text, Send Media, Send Template (WhatsApp) |
| Channel | Get Many, Get, Generate OAuth URL, Exchange OAuth Code, Update (webhook settings + subscription binding), Deactivate |
| Media | Download (saves received file as binary data) |
| Contact | Get Profile (Instagram, Facebook — enriches sender with name, profile picture, follower count) |
| Template | Get Many, Get, Create, Update, Delete (WhatsApp only) |
| Redirect URI | Get Many, Add, Delete |
| Subscription | Get Many (subscriptions, assigned channels, available slots by channel type and tier) |

### Trigger node — events

The trigger starts your workflow for any of these events:

| Event | Channels |
|-------|---------|
| `message.received` | WhatsApp, Instagram, Facebook |
| `message.echo` | WhatsApp (Coexistence only), Instagram, Facebook |
| `message.delivered` | WhatsApp, Instagram, Facebook |
| `message.read` | WhatsApp, Instagram, Facebook |
| `message.sent` | WhatsApp |
| `message.failed` | WhatsApp |

Filter by event type in node settings. HMAC-SHA256 signature verification is built in. `message.echo` is off by default — select **Message Echo** explicitly (see [Message echoes](#message-echoes-messages-sent-outside-fiwano)).

---

## Installation

Fiwano is [verified by n8n](https://n8n.io/integrations/fiwano/) and can be installed directly from the n8n editor by an instance owner or admin.

### n8n app (verified community node)

1. Open the editor canvas and open the nodes panel with **+** or **N**.
2. Search for **Fiwano**.
3. Select **Fiwano** under **More from the community**.
4. Click **Install**.
5. Add the **Fiwano** or **Fiwano Trigger** node to your workflow.

See n8n's [verified community node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/verified-install/) for details. On n8n Cloud, installation may need to be enabled by the instance owner in the Cloud Admin Panel. On self-hosted n8n, the related community-node settings are controlled by environment variables.

### Manual install fallback

Use manual npm installation only when the in-app verified-node installation is unavailable in your environment.

#### Self-hosted npm


```bash
mkdir -p ~/.n8n/nodes
cd ~/.n8n/nodes
npm install n8n-nodes-fiwano
# Restart n8n
```

### Self-hosted Docker

No custom image required — install Fiwano in-app via **Settings → Community Nodes** (or the nodes panel above). The package is stored in the n8n data volume, so keep `~/.n8n` (`/home/node/.n8n` in the official image) on a persistent volume and it survives restarts and upgrades.

To bake it into a custom image instead, follow n8n's [community-node installation guide](https://docs.n8n.io/integrations/community-nodes/installation/).

---

## Credentials

1. [Sign up at fiwano.com](https://fiwano.com/auth/login) and create an API key in **API Keys**
2. In n8n: **Credentials → Add → Fiwano API** → paste the key (starts with `mip_live_`)
3. *(Optional)* Set a **Webhook Secret** on the credential to reuse one HMAC secret across all workflows — the trigger and the **Exchange OAuth Code** / **Update** operations fall back to it when their own secret field is empty.

All Fiwano action nodes use this credential. The **Fiwano Trigger** node works without credentials in manual mode (it only verifies the webhook signature you configure per-channel). Add the same credential to the trigger **only** if you want it to auto-register its webhook on your channels — see [Setting Up the Trigger](#setting-up-the-trigger-webhooks).

---

## Connecting a Channel

Two ways to connect a channel — pick based on **whose** channel it is:

- **Your own channels** → the [Fiwano portal](https://fiwano.com) UI (no code). Simplest when you just need your own WhatsApp / Instagram / Facebook in your automation.
- **Your customers' channels** → the API (the nodes below, or the [Connect a Channel workflow](#example-workflows)). This embeds a "connect your channel" step into your own product, so an external client authorizes their own Meta account through *your* interface — they never need a Fiwano account.

The API flow is Facebook OAuth, run once per channel (WhatsApp number / Instagram account / Facebook Page):

1. Add a **Fiwano** node → Resource: **Channel** → Operation: **Generate OAuth URL**
   - Select channel type, provide your redirect URI (must be registered via **Redirect URI → Add**)
   - Run the node → copy the `setup_url` from the output
2. Open that URL in a browser and authorize the page(s)
3. Add another **Fiwano** node → **Channel → Exchange OAuth Code**
   - Paste the `code` from the redirect URL query parameter — it is single-use and short-lived, so exchange it promptly
   - On failure the redirect carries `error` instead: `access_denied` (user cancelled or did not complete the Meta dialog), `slot_occupied` (the user connected a *different* Meta account than the one holding your subscription slot — `message` names the channel to reconnect or release), `session_expired` (the setup URL expired; generate a new one) or `setup_failed` (anything else). **Branch on `error` only** — the companion `message` is free-form English for display and may change
   - Optionally set `webhook_url` and `webhook_secret` in Additional Fields
4. The response contains `channel_id` — save it for all subsequent nodes

The same **Generate OAuth URL** operation also **reconnects** an inactive channel — there is no separate reconnect operation. Run the flow again for the same Meta account and Fiwano reactivates the existing row, so **Exchange OAuth Code** returns the channel ID you already stored.

Alternatively, manage everything from the [Fiwano portal](https://fiwano.com) UI.

### Turning webhook delivery off

**Channel → Update** → additional field **Clear Webhook URL** removes the webhook from a
channel. Event delivery stops until a URL is set again; the channel keeps its secret and
its event selection, so restoring is just setting the URL back.

Leaving the **Webhook URL** field blank does *not* clear it — a blank value is ignored, so
that an unfilled field can never silently stop delivery. Clearing is always the explicit
toggle.

### Subscription slots

Each subscription grants **one slot per channel type** — one WhatsApp, one Instagram, one Facebook. Use **Subscription → Get Many** to see what is free:

- `available_slots.<channel_type>.total > 0` means a **new** channel of that type can be connected.
- It does **not** gate reconnecting an inactive channel: a deactivated channel keeps its slot, and that reserved slot is what lets you bring it back.
- `assigned_channels` shows which channel sits in each slot. The reverse lookup is `subscription.id` on the channel itself in **Channel → Get Many**.

**Generate OAuth URL** tells you when a connect cannot go ahead: HTTP `402` means the account has no active subscription at all; HTTP `409` means subscriptions exist but every slot of that channel type is taken — the error lists the channels holding them, so you know what to reconnect or release. (In the API a *subscription* is what the portal's Billing page calls a *license* — same thing.)

**Deactivate is a soft delete.** It stops the channel sending and receiving, but keeps its ID, history and **its subscription slot**. Deactivating alone does not free a slot.

To actually replace a channel, release the slot in a second step with **Channel → Update** → **Release Subscription Slot**:

```
Channel → Deactivate            (channel_id = old channel)
Channel → Update                (channel_id = old channel, Release Subscription Slot = true)
Channel → Generate OAuth URL    (user connects the new Meta account)
Channel → Exchange OAuth Code   (new channel takes the freed slot)
```

Setting **Subscription ID** to an actual ID instead **moves** the channel to that subscription — no downtime, and the channel does not have to be deactivated first. An empty Subscription ID is ignored; releasing is always the explicit toggle, so an expression that happens to resolve to empty can never retire a channel.

> **Releasing a slot is effectively permanent.** Once another channel takes the freed slot, the released one can no longer be reconnected until a slot is free again. Treat it as retiring that channel, not pausing it. Moving a channel to a **Starter** subscription stops media and template sending immediately.

---

## Setting Up the Trigger (Webhooks)

The **Fiwano Trigger** node starts a workflow when a message arrives on your channel. There are two ways to wire it up.

### Option A — Automatic setup (recommended)

Let the trigger register its own webhook on your channel(s).

1. Add **Fiwano Trigger** and add your **Fiwano API** credential to it (needed for the auto modes — they error at activation if it's missing)
2. Set **Webhook Auto-Setup**:
   - **All Active Channels** — wire every connected channel (WhatsApp + Instagram + Facebook) that isn't already pointing elsewhere to this one trigger. One flow, three platforms.
   - **Specific Channel** — register on a single **Channel ID** (takes it over even if it already has a webhook).
3. Choose **Event Types** — these are **written to** each channel's `webhook_events` (overwriting what was there). Leave it empty to have auto-setup wire only the URL and **leave the channel's existing events unchanged** (manage them in the portal or via **Channel → Update**). New nodes start with `message.received` selected.
4. *(Recommended)* Set a **Webhook Secret** to verify incoming signatures — preferably on the **credential** (reused everywhere; see [Credentials](#credentials)). The trigger's own Webhook Secret field overrides it.
5. **Save and activate** the workflow — the trigger PATCHes the channel(s) with its webhook URL, events, and secret. Deactivating clears the webhook URL again (in "All" mode, only on channels still pointing at this trigger).

Auto-setup requires n8n's **Production URL** to use HTTPS and not point to
`localhost`, `127.0.0.0/8`, or `::1`. If n8n resolves an HTTP or loopback
Production URL, activation stops before changing any Fiwano channel and tells
you to configure `WEBHOOK_URL`, restart n8n, or use Manual setup. A domain that
merely contains the word `localhost` (for example `localhost.example.com`) is
not treated as localhost.

Official Fiwano nodes identify their API calls with a non-authentication client
marker so channel webhook changes made by auto-setup can be distinguished from
Portal and custom API changes in the Fiwano audit log. API-key authentication is
unchanged.

### Option B — Manual setup

Set **Webhook Auto-Setup** to **Manual** (no credential needed on the trigger).

1. Create a workflow, add **Fiwano Trigger**, choose event types (default: `message.received`)
2. **Save and activate** the workflow — n8n assigns a permanent webhook URL
3. Open the **Fiwano Trigger** node and copy its **Production URL** (format: `https://your-n8n.example.com/webhook/<uuid>`)
4. In a **Fiwano** node → **Channel → Update**, set the fields below, then execute the node once:
   - `channel_id` — your channel
   - `webhook_url` — the Production URL from step 3
   - Leave `webhook_secret` empty to auto-generate one, or provide your own
5. The response includes `webhook_secret` — copy it into the **Webhook Secret** field in the Trigger node
6. Re-save the workflow

> **n8n must be publicly accessible.** Fiwano delivers webhooks over the internet. Local `localhost` won't work — use a reverse proxy, ngrok, or n8n Cloud.

> **Event filter vs. channel subscription.** The trigger's **Event Types** filter is applied on the n8n side (empty = process every event that arrives). In **automatic** setup the same selection is also **written to** the channel's `webhook_events`, overwriting what was there — **except when it's empty**, in which case auto-setup leaves the channel's events untouched and you configure them yourself (portal or **Channel → Update**). In **manual** setup, make sure the events you enable on the channel match what the trigger expects.

> **When auto-setup runs.** Only on workflow **activation / deactivation** (and when n8n restarts active workflows) — never per message, so it adds no per-message overhead.
>
> - **Non-destructive, and silent about it.** "All Active Channels" only wires channels that aren't already pointing somewhere else; a channel wired to another URL is left alone — **and the workflow still activates without an error**. So if one channel isn't responding, check whether its webhook points elsewhere. To take a channel over deliberately, clear its webhook or use **Specific Channel**.
> - **Deactivating removes the webhook** from the channels pointing at this trigger — it clears the webhook URL only, it does not delete the channel, messages, or any data. While deactivated, inbound events are **neither relayed nor stored** — reactivate to resume delivery.
> - **Clean up before removing.** Deactivate the workflow (don't just delete it, and don't remove the credential first) so the trigger can clear the webhook. If cleanup can't run, a channel keeps pointing at an inactive n8n URL and Fiwano will log delivery failures and email you until you clear it (via **Update** or the portal).
> - Connect a new channel after activating? Re-activate the workflow so it gets wired.

### Webhook Payload Structure

Every event from Fiwano follows the same top-level shape:

```json
{
  "event": "message.received",
  "channel_id": "a1b2c3d4e5f67890",
  "channel_type": "whatsapp",
  "timestamp": "2025-01-15T10:30:00Z",
  "data": { ... }
}
```

Key fields available in expressions after the trigger:

| Expression | Value |
|---|---|
| `{{ $json.channel_id }}` | Channel that received the message |
| `{{ $json.channel_type }}` | `whatsapp` / `instagram` / `facebook` |
| `{{ $json.data.from }}` | Sender ID — use as `recipient` when replying |
| `{{ $json.data.from_name }}` | Sender name (WhatsApp only; `null` on Instagram/Facebook) |
| `{{ $json.data.text }}` | Message text (for `type: text` messages) |
| `{{ $json.data.type }}` | `text`, `image`, `audio`, `video`, `document`, `sticker`, or `unsupported` |
| `{{ $json.data.media.media_id }}` | ID to download file via `GET /api/v1/media/{media_id}` (Pro license) |
| `{{ $json.data.media.voice }}` | `true` for WhatsApp voice messages (boolean, WA only; omitted for IG/FB) |
| `{{ $json.data.media.download_url }}` | Authenticated download URL — fetch with your `X-API-Key`. `null` if download from Meta failed. **Cannot be used directly as `media_url` for outbound sends** — re-host the bytes first. |
| `{{ $json.data.media.mime_type }}` | MIME type of the received file |
| `{{ $json.data.media.file_size }}` | File size in bytes |
| `{{ $json.data.media.filename }}` | Original filename (documents only; `null` otherwise) |
| `{{ $json.data.media.duration_ms }}` | Duration in ms (audio/video only; `null` otherwise) |
| `{{ $json.data.media.expires_at }}` | ISO 8601 expiry timestamp — file deleted after this time |
| `{{ $json.data.media.error }}` | Present only when Fiwano could not download the file from Meta; `download_url` is then `null` |
| `{{ $json.data.caption }}` | Text Meta sent together with the media — all channels. Plain text messages use `data.text` instead |
| `{{ $json.data.unsupported_type }}` | On `type: "unsupported"` — what Meta actually sent (see below) |
| `{{ $json.data.upgrade_required }}` | `"pro"` if channel lacks a Pro license for this message |
| `{{ $json.data.status }}` | On `message.delivered` / `read` / `failed` — `"delivered"`, `"read"`, `"failed"` |
| `{{ $json.data.errors }}` | On `message.failed` — Meta's raw error array, e.g. `[{"code":131047,"title":"..."}]`. `data.error` holds the readable summary |

### Messages with several attachments

When a user sends an album (several files in one Instagram or Facebook message), Fiwano delivers **one `message.received` event — and one trigger execution — per attachment**. There is never an array of events in a single execution, so a workflow that handles one file already handles albums.

What to rely on:

- All files are downloaded **before the first event is sent**, then events arrive in Meta's attachment order.
- `data.caption` is on the **first** event only.
- The first event keeps Meta's own message ID; later parts get `.2`, `.3`, … appended. **Treat `data.message_id` as an opaque idempotency key** — do not parse the suffix and do not pass the ID back to Meta.
- Retries are independent per event, so a failing endpoint can see a later part before a retried earlier one. Do not assume strict arrival order.
- One failed download does not suppress the rest: that event carries `media.download_url: null` and `media.error`.

WhatsApp is unaffected — Meta already delivers each WhatsApp media message separately.

### `type: "unsupported"`

`data.type` is a closed set — `text`, `image`, `audio`, `video`, `document`, `sticker` (WhatsApp only), `unsupported` — and never a raw provider value, so it is safe to switch on. `unsupported` means Fiwano cannot hand you the content as a file, and `data.unsupported_type` says what it was. Two cases, told apart by `upgrade_required`:

| Case | Looks like | What to do |
|---|---|---|
| Media on a **Starter** license | `unsupported_type` is the media type (`image`, …) **and** `upgrade_required: "pro"` | Upgrade to Pro to receive the file |
| Content that is not a file | `unsupported_type` is Meta's own name — `location`, `contacts` (WhatsApp), `share`, `ig_reel`, `story_mention`, `fallback`, `template` (Instagram/Facebook) — and **no** `upgrade_required` | No tier delivers these as files; handle or ignore |

There is no `data.media` block on `unsupported`. An unfamiliar `unsupported_type` is still just unsupported content — treat the list as open. Message reactions are dropped entirely and never arrive as events.

### Message echoes (messages sent outside Fiwano)

When someone on your side answers a customer **without going through Fiwano** — the WhatsApp Business App, the Instagram inbox, the Facebook Page Inbox, Meta Business Suite, or another integration — Meta echoes that message back, and Fiwano can deliver you a copy so your workflow sees the whole conversation, not just its own half.

Enable it by selecting **Message Echo** in the trigger's **Event Types** (in auto-setup mode this registers `message.echo` on the channel). It is **off by default** on every plan, and leaving Event Types empty does **not** enable it — echo must be chosen explicitly. Available on Starter and Pro; on WhatsApp it fires only for **Coexistence** numbers (a Cloud-API-only channel has no external messages to echo).

A `message.echo` event uses the same envelope as every other event; the `data` block looks like:

| Expression | Value |
|---|---|
| `{{ $json.data.message_id }}` | A Fiwano UUID, **stable** across redeliveries — deduplicate on it |
| `{{ $json.data.recipient }}` | Who the message was sent to, in the same format the send operations accept — reply to it directly |
| `{{ $json.data.status }}` | Always `"sent"` (the message exists in the conversation; there is no separate `message.sent` for echoes) |
| `{{ $json.data.type }}` | `text`, `image`, `audio`, `video`, `document`, `sticker`, or `unsupported` — same closed set as `message.received` |
| `{{ $json.data.text }}` / `{{ $json.data.caption }}` | The text, or the caption on a media echo |

> **Never mirror an echo back into the same conversation without deduplicating by `message_id`.** Your own reply generates no echo (Fiwano's sends are filtered out), but a bot on the other side — or a second integration echoing too — can create a loop.

**Media in echoes is not delivered.** An echoed media message keeps its real `data.type` and caption, but the file is skipped: `data.media` arrives with `download_url: null` and `unavailable: "echo_media_not_supported"`. The rule you already apply to inbound media — check `data.media.download_url` before fetching — covers this with no extra code. Multi-attachment Instagram/Messenger messages split into one echo per attachment, each with its own `message_id`.

**Not delivered as echoes:** reactions, message edits, and message deletions (unsend) — they are changes to an existing message, not new messages, and are silently skipped.

#### Tracking delivery/read status for echoes

By default an echo is a one-off copy with no `delivered`/`read` follow-ups. To get the same status lifecycle echoes as messages you send through Fiwano, turn on **Track Echo Statuses** on the channel via **Channel → Update** (or **Exchange OAuth Code**) — it maps to the API's `echo_statuses`. Subsequent `message.delivered` / `message.read` / `message.failed` webhooks then reference the same echo `message_id` and are filtered by your Event Types exactly like ordinary statuses (this creates tracking records on Fiwano's side).

Statuses and echoes are delivered independently and at-least-once — a status can occasionally arrive **before** the echo it belongs to. Correlate by `message_id` and upsert rather than relying on arrival order. WhatsApp/Facebook deliver both `delivered` and `read`; Instagram delivers only `read` (Meta does not provide `delivered`).

---

## Sending Messages

### Reading the send result

All three send operations answer HTTP `200` even when the send fails, and report the
outcome in the item's `success` and `status` fields:

| `status` | `success` | What it means |
|---|---|---|
| `sent` | `true` | Meta accepted it. Track the rest via `message.delivered` / `read` / `failed` webhooks. |
| `queued` | `true` | Meta did not give a final answer in time (transient failure, or a slow media download). Fiwano finishes the send in the background, retries transient failures (7 attempts over ~20 min), and emails the channel owner if they run out. Never resend a `queued` message yourself. **Send Text and Send Media only** — templates are never queued. |
| `failed` | `false` | Meta rejected the message permanently. Not retried. `error` carries Meta's text and `error_code` Meta's code. The channel owner receives a delivery digest email. |

`message_id` is a Fiwano UUID, not a Meta ID. Every later delivery-status webhook
references that same UUID.

#### Error on Failed Send

What happens on `failed` is controlled by the **Error on Failed Send** option on the
three send operations:

- **On** (default on node version 2 — what you get when adding a Fiwano node): the node fails with
  `Send failed: <Meta's text> (Meta error <code>)` and a hint on what to do. Handle it
  like any other node error — with **Settings → On Error → "Continue (using error
  output)"** the failed send lands on the node's error output as an item made of your
  input fields plus an `error` **object**: `error.message`, `error.hint`,
  `error.meta_error` (Meta's own text), `error.error_code`, `error.status`,
  `error.message_id`, `error.success: false`. Branch on it directly, e.g.
  `IF {{ $json.error.error_code }} is equal to 131047 → Send Template`. (Other node
  errors, such as an empty recipient or an HTTP `400`, keep `error` as a plain string —
  n8n itself allows an error-output item to carry nothing but `error`, so the object
  is how the send outcome survives the trip.)
- **Off** (default on node version 1): the failed send comes back as a normal item with
  `success: false` and the node stays **green**.
  Branch on it yourself:

  ```
  IF  {{ $json.success }}  is false   → your failure path
  ```

  A note in the output pane reminds you of this before a run, and after a run tells you
  how many sends were rejected. **With the option off, "Continue (using error output)"
  does not catch rejected sends** — n8n routes only thrown errors there, and a returned
  item is not an error.

A node's version is shown in its **Settings** tab and never changes on its own; the
option can be switched either way on both versions. A version 1 node moves to version 2
only by being replaced with a fresh Fiwano node from the palette.

#### What the failure means

`error_code` is Meta's code, passed through unchanged, and the error hint repeats the
advice from this table:

| `error_code` | What it means | What to do |
|---|---|---|
| `100` | Meta rejected a parameter (recipient, text, media URL or size) | Read `error`; check the recipient format, `media_url`, `media_type` and file size |
| `10`, `200` | Meta denies this action for the account — **not** a token problem, the channel stays connected | Check the account in Meta Business Settings |
| `190` | Access token expired or revoked | Reconnect the channel |
| `551` | Messenger / Instagram: this person cannot be messaged now (blocked the Page, closed the chat, never messaged it) | Nothing on your side; only they can lift it. Do not resend automatically |
| `803` | Meta does not know this recipient | Check the identifier |
| `131026` | Recipient is not reachable on WhatsApp | Verify the number |
| `131047`, `131057` | Outside the 24h window (WhatsApp) | Switch to Send Template |
| `131052` | Meta could not download from `media_url` | URL unreachable, expired signature, or wrong Content-Type — verify the URL works in a fresh request |
| `131053` | Format/size unsupported, or Meta rate-limited your hosting provider's network | Retry; if persistent, use AWS S3 / GCS / Cloudflare R2 |

Codes outside the table are passed through as Meta returns them; the full list is in the
[API documentation](https://fiwano.com/documentation/errors#send-error-codes).

#### Requests Fiwano refuses before calling Meta

These are ordinary node errors (HTTP `400`/`422`), independent of the option above:

- **Recipient** empty, or without any digit (a common sign of a broken expression —
  `{{ $json.data }}` becomes `[object Object]`, a missing field becomes empty), or not a
  numeric PSID/IGSID on a Messenger/Instagram channel → `invalid_recipient`. The node
  checks the first two cases itself before making the request and tells you to use
  `{{ $json.data.from }}`. Note that delivery-status events (`delivered`, `read`) carry
  `data.recipient`, not `data.from` — there is no sender to reply to.
- **Text** empty or whitespace-only → `422`; over the channel limit → `text_too_long`.
- A WhatsApp send to the channel's own number → `recipient_equals_sender`.

### Text message

```
Resource: Message → Operation: Send Text
Channel ID: <channel_id>
Recipient: {{ $('Fiwano Trigger').item.json.data.from }}
Text: Hello!
```

Text must contain at least one non-whitespace character — empty or whitespace-only values are rejected with HTTP `422` before Meta is called. Per-channel length caps are WhatsApp 4096, Facebook 2000, Instagram 1000; oversize text is rejected with `400`, and Fiwano does not auto-split. The recipient is trimmed of surrounding whitespace and must contain digits (see [Requests Fiwano refuses before calling Meta](#requests-fiwano-refuses-before-calling-meta)).

Sends are limited to **10 accepted sends per second per channel**, shared across all API keys. Exceeding it returns HTTP `429` with `Retry-After`, which the node surfaces in the error description.

### WhatsApp template

Outside the 24-hour conversation window, WhatsApp requires pre-approved templates.

```
Resource: Message → Operation: Send Template
Channel ID: <wa_channel_id>
Recipient: <phone_without_plus>
Template Name: order_confirmation
Language: en_US
Variables: {"body": ["John", "ORD-456"]}
```

Variable format:
- **Positional** (numbered `{{1}}`, `{{2}}`): `{"body": ["val1", "val2"], "header": ["val"], "buttons": [{"index": 0, "value": "abc"}]}`
- **Named** (custom keys): `{"body": {"customer_name": "John"}}`
- Leave empty if the template has no variables

### Media message (image, audio, video, document)

Send a media file via HTTPS URL. **Requires a Pro license** on the channel's billing plan.

```
Resource: Message → Operation: Send Media
Channel ID: <channel_id>
Recipient: {{ $('Fiwano Trigger').item.json.data.from }}
Media Type: image
Media URL: https://my-bucket.s3.amazonaws.com/photo.jpg?X-Amz-Signature=...
Additional Fields → Caption: Check this out!
```

Meta fetches the file directly from `Media URL` — Fiwano does not download or store it.

**For non-public content, use a signed URL** — S3/GCS/R2 presigned, Azure SAS, or HMAC-signed URL on your own server. Set expiry to **≥ 20 minutes** so background retries can still fetch the file. Public URLs are accessible to anyone who learns them.

Send Media is **synchronous and can be slow**: Meta downloads your file inside the request, so the wait scales with file size and your hosting. Fiwano gives up on Meta after 30 seconds — set your own timeout to at least 35 seconds if you call this from outside n8n.

URL validation: HTTPS only, max 2048 chars, no credentials in URL (`user:pass@`), no private/loopback IPs. Violations return HTTP 422.

Supported types per channel:

| Media Type | WhatsApp | Instagram | Facebook |
|------------|----------|-----------|----------|
| image | ✓ | ✓ | ✓ |
| audio | ✓ | ✓ | ✓ |
| video | ✓ | ✓ | ✓ |
| document | ✓ | ✓ | ✓ (as file) |

**Handling errors.** A media send that Meta rejects follows the same rules as text —
see [Reading the send result](#reading-the-send-result). The media-specific codes are
`131052` (Meta could not download the URL) and `131053` (format/size, or Meta
rate-limited your hosting provider); `100` also covers a file above the size cap.

> Channels without a Pro license return HTTP 402. Upgrade at [fiwano.com/billing](https://fiwano.com/billing).

---

## Enriching Sender Profile (Instagram & Facebook)

Instagram and Facebook webhooks do not include the sender's name. Use **Contact → Get Profile** immediately after a Fiwano Trigger to fetch it:

- **Instagram:** returns `username`, `name`, `profile_pic`, `follower_count`, `is_verified_user`
- **Facebook:** returns `first_name`, `last_name`, `profile_pic`
- Results are cached 5 minutes on Fiwano's side
- Not applicable for WhatsApp (name is always present in `data.from_name`)

---

## Common Patterns

**Reply to same channel and sender:**
```
channel_id: {{ $json.channel_id }}
recipient:  {{ $json.data.from }}
```

**Only process text messages:**
`IF → $json.data.type === 'text'`

**Get sender name on Instagram/Facebook:**
Add **Contact → Get Profile** (Channel ID: `$json.channel_id`, User ID: `$json.data.from`) immediately after the trigger.

**Filter by channel type:**
`IF → $json.channel_type === 'whatsapp'`

---

## Example Workflows

Two ready-made flows live in the [`workflows/`](./workflows/) directory. They assemble the pieces above (credential → channel → trigger → send), so you can import one and skip the manual wiring.

| File | Description |
|------|-------------|
| `fiwano-connect-channels.json` | **Connect channels via the API** *(optional)*. Only needed if you onboard channels **programmatically** — e.g. connecting your own clients' channels. If connecting from the [Fiwano portal](https://fiwano.com) UI is enough for you, you don't need this. Connects one channel at a time: pick a channel type, generate a Meta setup link, and a webhook callback auto-exchanges the returned code for a `channel_id` — no copy-pasting codes. |
| `fiwano-universal-auto-responder.json` | **Auto-reply to every message.** One trigger answers **every** message on WhatsApp, Instagram and Facebook — echoes text, and replies to attachments with file details. Includes a sticky recipe for a full media echo. **Needs at least one connected channel** — connect in the [portal](https://fiwano.com), or with the workflow above. |

**Import (works on any n8n, including Cloud):** create a new workflow → **⋮ menu → Import from File** → select the `.json`.

**After importing, finish setup before the workflow will run:**
1. Add your **Fiwano API** credential to the nodes that use it (see [Credentials](#credentials)).
2. For `fiwano-connect-channels.json`, add the OAuth-callback node's **Production URL** to your whitelisted redirect URIs (**Redirect URI → Add**, or in the [portal](https://fiwano.com)).
3. **Activate** the workflow — the trigger and the OAuth-callback webhook only fire while the workflow is active.

On **self-hosted** n8n you can also import from the command line, run on the machine where n8n is installed (the `--input` path is relative to your current directory; the workflow is imported **inactive** — activate it in the UI afterwards):
```bash
n8n import:workflow --input=workflows/fiwano-universal-auto-responder.json
```

---

## Links

- [fiwano.com](https://fiwano.com) — product page & free trial
- [API Documentation](https://fiwano.com/documentation)
- [Fiwano Cookbook](https://github.com/fiwano-com/fiwano-cookbook) — step-by-step guide for integrating the API directly in code (handy for AI coding agents)
- [Portal](https://fiwano.com/auth/login)

## License

MIT — © Roman Babakin / [rmnbb.com](https://rmnbb.com)
