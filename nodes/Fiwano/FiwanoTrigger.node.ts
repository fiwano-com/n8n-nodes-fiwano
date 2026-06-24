import { createHmac, timingSafeEqual } from 'crypto';
import {
	IDataObject,
	IHookFunctions,
	IHttpRequestOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';

const BASE_URL = 'https://fiwano.com/api/v1';

// All webhook event types Fiwano can deliver. Used when the user leaves the
// event filter empty in auto-setup mode — the channel is subscribed to all of
// them and Fiwano keeps only the ones valid for the channel's type.
const ALL_EVENTS = [
	'message.received',
	'message.sent',
	'message.delivered',
	'message.read',
	'message.failed',
];

export class FiwanoTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Fiwano Trigger',
		name: 'fiwanoTrigger',
		icon: 'file:fiwano.svg',
		group: ['trigger'],
		version: 1,
		description:
			'Receive webhook events from Fiwano (incoming messages, delivery status, etc.)',
		defaults: {
			name: 'Fiwano Trigger',
		},
		inputs: [],
		outputs: ['main'],
		// Credentials are optional at the node level: required only for the
		// auto-setup modes (which call the API), optional in Manual. We keep a
		// single entry here — declaring the same credential twice with
		// displayOptions (to make it conditionally required) breaks the n8n editor's
		// rendering of the parameter those displayOptions reference (autoSetup).
		// The auto modes still surface a clear error at activation if no credential
		// is attached.
		credentials: [{ name: 'fiwanoApi', required: false }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Webhook Auto-Setup',
				name: 'autoSetup',
				type: 'options',
				options: [
					{
						name: 'Manual',
						value: 'manual',
						description: 'You configure the webhook URL on the channel yourself (no credential needed)',
					},
					{
						name: 'All Active Channels',
						value: 'all',
						description:
							'On activation, point every active channel that is not already wired elsewhere at this trigger (one flow handles WhatsApp + Instagram + Facebook). Channels already pointing at another URL are left untouched.',
					},
					{
						name: 'Specific Channel',
						value: 'channel',
						description: 'On activation, register this trigger on a single channel ID (takes the channel over even if it already has a webhook)',
					},
				],
				default: 'manual',
				description:
					'How this trigger\'s webhook URL gets registered on your Fiwano channel(s). "All Active Channels" and "Specific Channel" require a Fiwano API credential and register/unregister automatically when the workflow is (de)activated.',
			},
			{
				displayName: 'Channel ID',
				name: 'channelId',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'e.g. a1b2c3d4e5f67890',
				description: 'The channel to register this trigger on',
				displayOptions: { show: { autoSetup: ['channel'] } },
			},
			{
				displayName: 'Webhook Secret',
				name: 'webhookSecret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description:
					'Secret used to verify HMAC-SHA256 signatures on incoming webhooks. In auto-setup mode it is also pushed to the channel(s). If left empty, the node falls back to the Webhook Secret stored on the Fiwano API credential; if that is also empty, signature verification is skipped (not recommended in production) and Fiwano keeps/generates its own secret.',
				hint: 'Overrides the credential\'s Webhook Secret. Leave empty to use the credential default.',
			},
			{
				displayName: 'Event Types',
				name: 'events',
				type: 'multiOptions',
				options: [
					{
						name: 'Message Delivered',
						value: 'message.delivered',
						description: 'Message delivered to the recipient (WhatsApp, Instagram, Facebook)',
					},
					{
						name: 'Message Failed',
						value: 'message.failed',
						description: 'Message delivery failed (WhatsApp only)',
					},
					{
						name: 'Message Read',
						value: 'message.read',
						description: 'Recipient read the message (WhatsApp, Instagram, Facebook)',
					},
					{
						name: 'Message Received',
						value: 'message.received',
						description: 'Incoming message from a user (WhatsApp, Instagram, Facebook)',
					},
					{
						name: 'Message Sent',
						value: 'message.sent',
						description: 'Your message was accepted by Meta (WhatsApp only)',
					},
				],
				default: ['message.received'],
				description:
					'Which event types this trigger processes. In auto-setup mode the same selection is registered as the channel\'s webhook_events; events invalid for a channel type are ignored by Fiwano. Leave empty to process (and, in auto-setup, subscribe to) all event types.',
			},
			{
				displayName:
					'Manual mode: set this node\'s Production URL (Webhook URLs, above) as the channel\'s webhook — in the Fiwano portal, or with the Fiwano node\'s "Update Webhook" operation — and use the same Webhook Secret on both sides. Prefer automatic wiring? Switch Auto-Setup to "All Active Channels".',
				name: 'setupNotice',
				type: 'notice',
				default: '',
				displayOptions: { show: { autoSetup: ['manual'] } },
			},
		],
	};

	// Auto-setup: when Auto-Setup is "All Active Channels" or "Specific Channel"
	// (and a Fiwano credential is attached), the trigger registers/removes its
	// webhook via PATCH /channels/{id} on activation/deactivation. In "Manual"
	// mode these are no-ops and the user wires the webhook URL themselves.
	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const mode = this.getNodeParameter('autoSetup', 'manual') as string;
				if (mode === 'manual') {
					// Never auto-register — report "exists" so n8n never calls create().
					return true;
				}
				// Auto modes: report "exists" (skip create on restart) only when there
				// is nothing left to do. We require both that the channel points at THIS
				// trigger AND that it has at least one event configured — channels
				// default to no events, so a URL-only check could leave a channel
				// silently receiving nothing. We deliberately do NOT compare the exact
				// event list: the server stores a per-channel-type-filtered set, so an
				// exact comparison would never match for IG/FB. A real config change
				// goes through a workflow save (deactivate → delete clears the URL →
				// checkExists sees a mismatch → create re-syncs url + events + secret).
				try {
					const url = this.getNodeWebhookUrl('default');
					if (!url) return false;

					if (mode === 'channel') {
						const channelId = (this.getNodeParameter('channelId', '') as string).trim();
						if (!channelId) return false;
						const ch = await fiwanoHookRequest.call(this, 'GET', `/channels/${channelId}`);
						return isOurs(ch, url) && hasEvents(ch);
					}

					// mode === 'all'
					const resp = await fiwanoHookRequest.call(this, 'GET', '/channels');
					const active = ((resp.channels as IDataObject[]) || []).filter((c) => c.is_active);
					if (active.length === 0) return false;
					// "Nothing to do" requires BOTH: we're actually wired to at least one
					// channel, AND no channel is still waiting to be wired (empty, or ours
					// but eventless). If every active channel points elsewhere we are not
					// registered anywhere → return false so create() runs and surfaces a
					// clear "nothing to wire" error instead of going live silently dead.
					const wiredToUs = active.some((c) => isOurs(c, url) && hasEvents(c));
					const needsWiring = active.some(
						(c) => !isForeign(c, url) && !(isOurs(c, url) && hasEvents(c)),
					);
					return wiredToUs && !needsWiring;
				} catch {
					// On any error, fall through to create().
					return false;
				}
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const mode = this.getNodeParameter('autoSetup', 'manual') as string;
				if (mode === 'manual') {
					return true;
				}

				const url = this.getNodeWebhookUrl('default');
				if (!url) {
					throw new NodeOperationError(
						this.getNode(),
						'Could not resolve the webhook URL for auto-setup. Save and activate the workflow, or use Manual setup.',
					);
				}

				const events = this.getNodeParameter('events', []) as string[];
				const secret = await resolveWebhookSecret(this);
				const body: IDataObject = {
					webhook_url: url,
					webhook_events: events.length > 0 ? events : ALL_EVENTS,
				};
				if (secret) {
					body.webhook_secret = secret;
				}

				if (mode === 'channel') {
					const channelId = (this.getNodeParameter('channelId', '') as string).trim();
					if (!channelId) {
						throw new NodeOperationError(
							this.getNode(),
							'Channel ID is required when Auto-Setup is "Specific Channel".',
						);
					}
					// Specific Channel takes the channel over explicitly.
					await fiwanoHookRequest.call(this, 'PATCH', `/channels/${channelId}`, body);
					return true;
				}

				// mode === 'all' — non-destructive: skip channels wired elsewhere.
				const resp = await fiwanoHookRequest.call(this, 'GET', '/channels');
				const active = ((resp.channels as IDataObject[]) || []).filter((c) => c.is_active);
				if (active.length === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'No active channels found to auto-register. Connect a channel first, or use Manual setup.',
					);
				}

				let wired = 0;
				for (const ch of active) {
					if (isForeign(ch, url)) {
						// Leave channels pointing at another URL untouched.
						continue;
					}
					await fiwanoHookRequest.call(this, 'PATCH', `/channels/${ch.id}`, body);
					wired += 1;
				}

				if (wired === 0) {
					throw new NodeOperationError(
						this.getNode(),
						'Every active channel already has a webhook pointing elsewhere, so nothing was wired. Clear those webhooks first, or use "Specific Channel" to take one over.',
					);
				}
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const mode = this.getNodeParameter('autoSetup', 'manual') as string;
				if (mode === 'manual') {
					return true;
				}

				const url = this.getNodeWebhookUrl('default');
				if (!url) {
					// Can't identify which channels are ours without our URL — skip cleanup.
					return true;
				}
				try {
					if (mode === 'channel') {
						const channelId = (this.getNodeParameter('channelId', '') as string).trim();
						if (channelId) {
							const ch = await fiwanoHookRequest.call(this, 'GET', `/channels/${channelId}`);
							// Only clear if it still points at us (another workflow may have
							// taken it over since).
							if (isOurs(ch, url)) {
								await fiwanoHookRequest.call(this, 'PATCH', `/channels/${channelId}`, {
									webhook_url: '',
								});
							}
						}
					} else {
						// "All": only clear channels that currently point at THIS trigger,
						// so we never disturb channels wired to another workflow.
						const resp = await fiwanoHookRequest.call(this, 'GET', '/channels');
						const channels = (resp.channels as IDataObject[]) || [];
						for (const ch of channels) {
							if (isOurs(ch, url)) {
								await fiwanoHookRequest.call(this, 'PATCH', `/channels/${ch.id}`, {
									webhook_url: '',
								});
							}
						}
					}
				} catch {
					// Best-effort cleanup — don't block deactivation.
					return false;
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const req = this.getRequestObject();
		const res = this.getResponseObject();

		const webhookSecret = await resolveWebhookSecret(this);
		const allowedEvents = this.getNodeParameter('events', []) as string[];

		// ── Signature verification ────────────────────────────────────────────
		if (webhookSecret) {
			const signatureHeader = req.headers['x-webhook-signature'] as string | undefined;

			if (!signatureHeader) {
				res.status(401).send('Missing X-Webhook-Signature header');
				return { noWebhookResponse: true };
			}

			// rawBody is populated by n8n before calling the webhook handler
			const rawBody: Buffer = (req as unknown as { rawBody: Buffer }).rawBody;
			if (!rawBody) {
				res.status(400).send('Unable to read raw request body for signature verification');
				return { noWebhookResponse: true };
			}

			const expectedSig = 'sha256=' + createHmac('sha256', webhookSecret)
				.update(rawBody)
				.digest('hex');

			// Timing-safe comparison to prevent timing attacks
			let signaturesMatch = false;
			try {
				signaturesMatch = timingSafeEqual(
					Buffer.from(signatureHeader),
					Buffer.from(expectedSig),
				);
			} catch {
				// Buffer.from lengths differ → mismatch
				signaturesMatch = false;
			}

			if (!signaturesMatch) {
				res.status(401).send('Invalid webhook signature');
				return { noWebhookResponse: true };
			}
		}

		// ── Parse body ────────────────────────────────────────────────────────
		const body = this.getBodyData() as IDataObject;

		// ── Event type filtering ──────────────────────────────────────────────
		if (allowedEvents.length > 0) {
			const eventType = body.event as string | undefined;
			if (eventType && !allowedEvents.includes(eventType)) {
				// Event filtered — acknowledge receipt but don't trigger workflow
				res.status(200).send({ received: true, filtered: true });
				return { noWebhookResponse: true };
			}
		}

		// ── Return event to workflow ──────────────────────────────────────────
		return {
			workflowData: [[{ json: body }]],
		};
	}
}

// ── Channel-state helpers (used by the auto-setup lifecycle hooks) ────────────

/** True if the channel's webhook already points at this trigger's URL. */
function isOurs(channel: IDataObject, url: string): boolean {
	return channel.webhook_url === url;
}

/** True if the channel has a webhook pointing at some OTHER URL (leave it alone). */
function isForeign(channel: IDataObject, url: string): boolean {
	return Boolean(channel.webhook_url) && channel.webhook_url !== url;
}

/** True if the channel has at least one webhook event configured. */
function hasEvents(channel: IDataObject): boolean {
	return Array.isArray(channel.webhook_events) && (channel.webhook_events as unknown[]).length > 0;
}

/**
 * Resolve the webhook secret: the trigger's own Webhook Secret field wins; if it
 * is empty, fall back to the `webhookSecret` stored on the Fiwano API credential
 * (if a credential is attached). Returns '' when neither is set.
 */
async function resolveWebhookSecret(ctx: IHookFunctions | IWebhookFunctions): Promise<string> {
	const nodeSecret = ((ctx.getNodeParameter('webhookSecret', '') as string) || '').trim();
	if (nodeSecret) {
		return nodeSecret;
	}
	try {
		const cred = await ctx.getCredentials('fiwanoApi');
		return (((cred?.webhookSecret as string) || '')).trim();
	} catch {
		return '';
	}
}

/**
 * Make an authenticated GET/PATCH request to the Fiwano API from a webhook
 * lifecycle hook (IHookFunctions). Used only for webhook auto-setup. Surfaces
 * credential/HTTP errors as NodeApiError.
 */
async function fiwanoHookRequest(
	this: IHookFunctions,
	method: 'GET' | 'PATCH',
	path: string,
	body?: IDataObject,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method,
		url: `${BASE_URL}${path}`,
		headers: { 'Content-Type': 'application/json' },
		json: true,
	};
	if (body && Object.keys(body).length > 0) {
		options.body = body;
	}

	try {
		return (await this.helpers.httpRequestWithAuthentication.call(
			this,
			'fiwanoApi',
			options,
		)) as IDataObject;
	} catch (error) {
		const err = error as Error;
		throw new NodeApiError(this.getNode(), {
			message:
				err.message ||
				'Fiwano webhook auto-setup failed. Add Fiwano API credentials, or switch Auto-Setup to Manual.',
		});
	}
}
