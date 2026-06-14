# n8n-nodes-fiwano

n8n verified community node for **[Fiwano](https://fiwano.com)** — a unified messaging API for **WhatsApp, Instagram DM, and Facebook Messenger**.

## What is Fiwano?

Fiwano is a verified Meta Tech Provider that abstracts the complexity of WhatsApp Cloud API, Instagram Messaging API, and Facebook Messenger API into a single, consistent REST API. Connect your Meta-verified business accounts once via simple Facebook auth — no Meta developer portal, no app setup, no individual channel verification required.

Key benefits:
- **Official Meta APIs only** — built on WhatsApp Cloud API, Instagram Messaging API and Facebook Messenger API. No browser automation, no unofficial client simulation, no account ban risk. Production-safe at any scale.
- **One API for three channels** — identical request format across WhatsApp, Instagram DM, and Facebook Messenger
- **Real-time webhooks** — incoming messages and delivery statuses delivered to your endpoint, HMAC-signed
- **WhatsApp template management** — create, manage, and send approved templates directly from the API
- **Auto token refresh** — Meta access tokens are refreshed automatically before expiry
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
| **Fiwano** | Action | Send messages, manage channels, WhatsApp templates, contact profile enrichment, redirect URIs |
| **Fiwano Trigger** | Webhook Trigger | Receive incoming messages and delivery status webhooks |

### Action node — operations

| Resource | Operations |
|----------|-----------|
| Message | Send Text, Send Media, Send Template (WhatsApp) |
| Channel | Get Many, Get, Generate OAuth URL, Exchange OAuth Code, Update Webhook, Delete |
| Media | Download (saves received file as binary data) |
| Contact | Get Profile (Instagram, Facebook — enriches sender with name, profile picture, follower count) |
| Template | Get Many, Get, Create, Update, Delete (WhatsApp only) |
| Redirect URI | Get Many, Add, Delete |

### Trigger node — events

The trigger starts your workflow for any of these events:

| Event | Channels |
|-------|---------|
| `message.received` | WhatsApp, Instagram, Facebook |
| `message.delivered` | WhatsApp, Instagram, Facebook |
| `message.read` | WhatsApp, Instagram, Facebook |
| `message.sent` | WhatsApp |
| `message.failed` | WhatsApp |

Filter by event type in node settings. HMAC-SHA256 signature verification is built in.

## Example Workflows

Ready-to-import workflows are in the [`workflows/`](./workflows/) directory:

| File | Description |
|------|-------------|
| `fiwano-complete-demo.json` | 9-section demo covering every operation: Echo Bot with profile enrichment (live trigger), channel management, template CRUD, text & template messaging, redirect URI management |

Import via n8n UI: **Workflows → (menu) → Import → select file**, or via CLI:
```bash
n8n import:workflow --input=workflows/fiwano-complete-demo.json
```

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

Build this package into a custom n8n image — no local `npm install` needed. See the [Docker setup guide](https://github.com/fiwano-com/n8n-nodes-fiwano#self-hosted-docker).

---

## Credentials

1. [Sign up at fiwano.com](https://fiwano.com/auth/login) and create an API key in **API Keys**
2. In n8n: **Credentials → Add → Fiwano API** → paste the key (starts with `mip_live_`)

All Fiwano action nodes use this credential. The trigger node does not need credentials (it only verifies the webhook signature you configure per-channel).

---

## Connecting a Channel

Channels are connected via Facebook OAuth. You do this once per channel (WhatsApp number / Instagram account / Facebook page).

1. Add a **Fiwano** node → Resource: **Channel** → Operation: **Generate OAuth URL**
   - Select channel type, provide your redirect URI (must be registered via **Redirect URI → Add**)
   - Run the node → copy the `oauth_url` from the output
2. Open that URL in a browser and authorize the page(s)
3. Add another **Fiwano** node → **Channel → Exchange OAuth Code**
   - Paste the `code` from the redirect URL query parameter
   - Optionally set `webhook_url` and `webhook_secret` in Additional Fields
4. The response contains `channel_id` — save it for all subsequent nodes

Alternatively, manage everything from the [Fiwano portal](https://fiwano.com) UI.

---

## Setting Up the Trigger (Webhooks)

The **Fiwano Trigger** node starts a workflow when a message arrives on your channel.

1. Create a workflow, add **Fiwano Trigger**, choose event types (default: `message.received`)
2. **Save and activate** the workflow — n8n assigns a permanent webhook URL
3. Copy the webhook URL from the node header (format: `https://your-n8n.example.com/webhook/<uuid>`)
4. In the **Fiwano** node → **Channel → Update Webhook**, set:
   - `channel_id` — your channel
   - `webhook_url` — the URL from step 3
   - Leave `webhook_secret` empty to auto-generate one, or provide your own
5. The response includes `webhook_secret` — copy it into the **Webhook Secret** field in the Trigger node
6. Re-save the workflow

> **n8n must be publicly accessible.** Fiwano delivers webhooks over the internet. Local `localhost` won't work — use a reverse proxy, ngrok, or n8n Cloud.

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
| `{{ $json.data.caption }}` | Caption text attached to the media (WhatsApp) |
| `{{ $json.data.upgrade_required }}` | `"pro"` if channel lacks a Pro license for this message |

---

## Sending Messages

### Text message

```
Resource: Message → Operation: Send Text
Channel ID: <channel_id>
Recipient: {{ $('Fiwano Trigger').item.json.data.from }}
Text: Hello!
```

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

**For non-public content, use a signed URL** — S3/GCS/R2 presigned, Azure SAS, or HMAC-signed URL on your own server. Set expiry to ≥ 5 minutes. Public URLs are accessible to anyone who learns them.

URL validation: HTTPS only, max 2048 chars, no credentials in URL (`user:pass@`), no private/loopback IPs. Violations return HTTP 422.

Supported types per channel:

| Media Type | WhatsApp | Instagram | Facebook |
|------------|----------|-----------|----------|
| image | ✓ | ✓ | ✓ |
| audio | ✓ | ✓ | ✓ |
| video | ✓ | ✓ | ✓ |
| document | ✓ | — | ✓ (as file) |

**Handling errors.** On Meta-side failure the response carries `success: false` and `error_code` (Meta error code) — branch on it in your workflow:

| `error_code` | What it means | What to do |
|---|---|---|
| `131052` | Meta could not download from URL | URL unreachable, expired signature, or wrong Content-Type — verify URL works in a fresh request |
| `131053` | Format/size unsupported, or Meta rate-limited your hosting provider's network | Retry; if persistent, use AWS S3 / GCS / Cloudflare R2 |
| `131047`, `131057` | Outside 24h window (WhatsApp) | Switch to Send Template |
| `190`, `200`, `10` | Token issue | Reconnect the channel |

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

## Links

- [fiwano.com](https://fiwano.com) — product page & free trial
- [API Documentation](https://fiwano.com/documentation)
- [Portal](https://fiwano.com/auth/login)

## License

MIT — © Roman Babakin / [rmnbb.com](https://rmnbb.com)
