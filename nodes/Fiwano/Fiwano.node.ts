import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeConnectionTypes,
	NodeOperationError,
	NodeApiError,
	JsonObject,
} from 'n8n-workflow';

import {
	FiwanoSendFailedError,
	SEND_OPERATIONS,
	fiwanoApiRequest,
	fiwanoApiRequestBinary,
	fiwanoSendFailedError,
	isFailedSend,
	recipientProblem,
} from './GenericFunctions';
import { channelOperations, channelFields } from './ChannelDescription';
import { messageOperations, messageFields } from './MessageDescription';
import { templateOperations, templateFields } from './TemplateDescription';
import { contactOperations, contactFields } from './ContactDescription';
import { redirectOperations, redirectFields } from './RedirectDescription';
import { mediaOperations, mediaFields } from './MediaDescription';
import { subscriptionOperations, subscriptionFields } from './SubscriptionDescription';

export class Fiwano implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Fiwano',
		name: 'fiwano',
		icon: { light: 'file:fiwano.svg', dark: 'file:fiwano.dark.svg' },
		group: ['output'],
		// Light versioning: one class, one execute(). Version 2 (1.4.0) changes a
		// single default — "Error on Failed Send" is on — so a rejected send fails
		// the node instead of passing as a green item. Nodes saved as version 1
		// keep their behaviour forever; n8n never upgrades a saved node by itself.
		version: [1, 2],
		defaultVersion: 2,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Fiwano — unified API for WhatsApp, Instagram & Facebook Messenger',
		defaults: { name: 'Fiwano' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'fiwanoApi', required: true }],
		hints: [
			{
				// Shown in the output pane before a run whenever the legacy behaviour
				// is active, so a user of a version-1 node (or anyone who switched the
				// option off) learns about it without reading the README.
				message:
					'Send operations answer HTTP 200 even when Meta rejects the message: the failed send comes back as a normal item with success: false and this node stays green. Turn on "Error on Failed Send" to fail the run instead, and use On Error → "Continue (using error output)" to branch on it.',
				type: 'info',
				location: 'outputPane',
				whenToDisplay: 'beforeExecution',
				displayCondition:
					'={{ $parameter["resource"] === "message" && $parameter["errorOnSendFailure"] === false }}',
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Channel', value: 'channel' },
					{ name: 'Contact', value: 'contact' },
					{ name: 'Media', value: 'media' },
					{ name: 'Message', value: 'message' },
					{ name: 'Redirect URI', value: 'redirect' },
					{ name: 'Subscription', value: 'subscription' },
					{ name: 'Template', value: 'template' },
				],
				default: 'message',
			},
			channelOperations,
			messageOperations,
			templateOperations,
			contactOperations,
			redirectOperations,
			mediaOperations,
			subscriptionOperations,
			...channelFields,
			...messageFields,
			...templateFields,
			...contactFields,
			...redirectFields,
			...mediaFields,
			...subscriptionFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];
		// Failed sends returned as items (option off) — surfaced as an execution
		// hint after the loop so the outcome is visible in the editor even though
		// the node stays green.
		let failedSendsAsItems = 0;

		for (let i = 0; i < items.length; i++) {
			const resource = this.getNodeParameter('resource', i) as string;
			const operation = this.getNodeParameter('operation', i) as string;

			try {
				let responseData: IDataObject;

				if (resource === 'media') {
					if (operation === 'download') {
						const mediaId = this.getNodeParameter('mediaId', i) as string;
						const binaryProperty = this.getNodeParameter('binaryProperty', i) as string;
						const { buffer, mimeType, fileName } = await fiwanoApiRequestBinary.call(this, mediaId);
						const binaryData = await this.helpers.prepareBinaryData(buffer, fileName, mimeType);
						returnData.push({
							json: { media_id: mediaId },
							binary: { [binaryProperty]: binaryData },
							pairedItem: { item: i },
						});
						continue;
					}
					throw new NodeOperationError(this.getNode(), `Unknown media operation: ${operation}`);
				} else if (resource === 'channel') {
					responseData = await executeChannel.call(this, operation, i);
				} else if (resource === 'message') {
					responseData = await executeMessage.call(this, operation, i);
					if (SEND_OPERATIONS.has(operation) && isFailedSend(responseData)) {
						// The default is version-dependent (see MessageDescription); the
						// fallback only matters if the parameter is somehow unresolvable.
						const failOnRejected = this.getNodeParameter('errorOnSendFailure', i, false) as boolean;
						if (failOnRejected) {
							throw fiwanoSendFailedError(this.getNode(), responseData, i);
						}
						failedSendsAsItems += 1;
					}
				} else if (resource === 'template') {
					responseData = await executeTemplate.call(this, operation, i);
				} else if (resource === 'contact') {
					responseData = await executeContact.call(this, operation, i);
				} else if (resource === 'redirect') {
					responseData = await executeRedirect.call(this, operation, i);
				} else if (resource === 'subscription') {
					responseData = await executeSubscription.call(this, operation);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource: ${resource}`);
				}

				const outputItems = Array.isArray(responseData)
					? (responseData as IDataObject[])
					: [responseData];
				returnData.push(
					...outputItems.map((item) => ({
						json: item ?? {},
						pairedItem: { item: i },
					})),
				);
			} catch (error) {
				if (this.continueOnFail()) {
					// Two n8n rules (n8n-core WorkflowExecute, read from the compiled source)
					// shape this item:
					//  1. an item reaches the error output only if `item.error` is set or
					//     its json is exactly {error} / {error, message};
					//  2. any item with `item.error` set gets its json REPLACED by
					//     {error: <message>} before it is stored.
					// So a rejected send keeps its API response the only way both rules
					// allow: json with the single key `error` holding an object. n8n then
					// merges the paired input item's fields around it on the error output.
					// Other failures keep the historical {error: <string>} shape.
					const response = error instanceof FiwanoSendFailedError ? error.response : undefined;
					const errorJson: IDataObject | string = response
						? {
								message: (error as Error).message,
								hint: (error as NodeOperationError).description ?? null,
								meta_error: (response.error as string | undefined) ?? null,
								error_code: (response.error_code as number | undefined) ?? null,
								status: (response.status as string | undefined) ?? 'failed',
								message_id: (response.message_id as string | undefined) ?? null,
								success: false,
							}
						: (error as Error).message;
					returnData.push({
						json: { error: errorJson },
						pairedItem: { item: i },
					});
					continue;
				}
				// Our own helpers already raise NodeApiError / NodeOperationError, which
				// carry the HTTP status and the actionable reason — re-throw those as-is.
				// Anything else is an unexpected fault in this node; wrap it so n8n shows
				// a node-attributed error instead of a bare stack trace.
				throw error instanceof NodeApiError || error instanceof NodeOperationError
					? error
					: new NodeApiError(this.getNode(), error as JsonObject);
			}
		}

		if (failedSendsAsItems > 0 && typeof this.addExecutionHints === 'function') {
			// Older n8n versions have no execution hints; the guard keeps them working.
			const count = failedSendsAsItems;
			this.addExecutionHints({
				message:
					`${count} send${count === 1 ? ' was' : 's were'} rejected by Meta (success: false, status: failed) and returned as ${count === 1 ? 'a normal item' : 'normal items'} — this node stays green by design. ` +
					'Turn on "Error on Failed Send" to fail the run instead, or branch on {{ $json.success }}.',
				type: 'warning',
				location: 'outputPane',
			});
		}

		return [returnData];
	}
}

// ── Channel ──────────────────────────────────────────────────────────────────

async function executeChannel(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject> {
	if (operation === 'getAll') {
		return fiwanoApiRequest.call(this, 'GET', '/channels');
	}
	if (operation === 'get') {
		const channelId = this.getNodeParameter('channelId', i) as string;
		return fiwanoApiRequest.call(this, 'GET', `/channels/${channelId}`);
	}
	if (operation === 'setupUrl') {
		const channelType = this.getNodeParameter('channelType', i) as string;
		const redirectUri = this.getNodeParameter('redirectUri', i) as string;
		return fiwanoApiRequest.call(this, 'POST', '/channels/setup-url', {
			channel_type: channelType,
			redirect_uri: redirectUri,
		});
	}
	if (operation === 'exchangeCode') {
		const code = this.getNodeParameter('code', i) as string;
		const extra = this.getNodeParameter('additionalFields', i) as IDataObject;
		const body: IDataObject = { code };
		if (extra.webhook_url) body.webhook_url = extra.webhook_url;
		// Secret: the explicit field wins; otherwise fall back to the credential's
		// default Webhook Secret when a webhook URL is being configured.
		const exSecret = (extra.webhook_secret as string)
			|| (extra.webhook_url ? await credentialWebhookSecret.call(this) : '');
		if (exSecret) body.webhook_secret = exSecret;
		if (extra.webhook_events && (extra.webhook_events as string[]).length > 0) {
			body.webhook_events = extra.webhook_events;
		}
		// Echo status tracking: only sent when the user added the field to the
		// collection (undefined = not added). An added-but-false value is meaningful
		// (explicitly relay-only), so key on `!== undefined`, not on truthiness.
		if (extra.echo_statuses !== undefined) body.echo_statuses = extra.echo_statuses;
		return fiwanoApiRequest.call(this, 'POST', '/channels/exchange-code', body);
	}
	if (operation === 'update') {
		const channelId = this.getNodeParameter('channelId', i) as string;
		const fields = this.getNodeParameter('updateFields', i) as IDataObject;
		const body: IDataObject = {};
		// Clearing needs an explicit opt-in rather than an empty Webhook URL. The
		// URL field predates this option, so treating "added but left blank" as
		// "remove the webhook" would silently stop event delivery for anyone who
		// had configured it that way.
		const clearing = fields.clear_webhook_url === true;
		if (clearing) body.webhook_url = '';
		else if (fields.webhook_url) body.webhook_url = fields.webhook_url;
		// Secret: the explicit field wins; otherwise fall back to the credential's
		// default Webhook Secret when a webhook URL is being configured. Never
		// while clearing — the channel keeps the secret it already has.
		const upSecret = (fields.webhook_secret as string)
			|| (!clearing && fields.webhook_url ? await credentialWebhookSecret.call(this) : '');
		if (upSecret) body.webhook_secret = upSecret;
		if (fields.webhook_events) body.webhook_events = fields.webhook_events;
		// Echo status tracking: only sent when the user added the field to the
		// collection (undefined = not added). An added-but-false value is meaningful
		// (explicitly relay-only), so key on `!== undefined`, not on truthiness.
		if (fields.echo_statuses !== undefined) body.echo_statuses = fields.echo_statuses;
		// Releasing a subscription slot is effectively permanent, so it needs its own
		// explicit opt-in. Driving it from an empty Subscription ID would mean an
		// expression that happens to resolve to '' silently retires the channel.
		if (fields.release_subscription_slot === true) {
			body.subscription_id = '';
		} else {
			const target = ((fields.subscription_id as string) ?? '').trim();
			if (target) body.subscription_id = target;
		}
		// An empty collection still sends PATCH {} (a harmless server-side no-op),
		// exactly as before. Rejecting it locally would be a nicer signal, but it
		// would newly fail workflows whose fields come from expressions that can
		// legitimately resolve to empty — not worth breaking on an upgrade.
		return fiwanoApiRequest.call(this, 'PATCH', `/channels/${channelId}`, body);
	}
	if (operation === 'delete') {
		const channelId = this.getNodeParameter('channelId', i) as string;
		return fiwanoApiRequest.call(this, 'DELETE', `/channels/${channelId}`);
	}
	throw new NodeOperationError(this.getNode(), `Unknown channel operation: ${operation}`);
}

// ── Subscription ─────────────────────────────────────────────────────────────

async function executeSubscription(
	this: IExecuteFunctions,
	operation: string,
): Promise<IDataObject> {
	if (operation === 'getAll') {
		return fiwanoApiRequest.call(this, 'GET', '/subscriptions');
	}
	throw new NodeOperationError(this.getNode(), `Unknown subscription operation: ${operation}`);
}

// ── Message ──────────────────────────────────────────────────────────────────

async function executeMessage(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject> {
	const channelId = this.getNodeParameter('channelId', i) as string;
	const rawRecipient: unknown = this.getNodeParameter('recipient', i);
	// Strict subset of the API's `invalid_recipient` preflight (empty / no
	// digits): the same request would get HTTP 400 anyway, this only names the
	// fix — prod 2026-09-05: an expression resolving to undefined and to a whole
	// object produced "" and "[object Object]" as recipients.
	const problem = recipientProblem(rawRecipient);
	if (problem) {
		throw new NodeOperationError(this.getNode(), problem.message, {
			itemIndex: i,
			description: problem.description,
		});
	}
	const recipient = String(rawRecipient);

	if (operation === 'send') {
		const text = this.getNodeParameter('text', i) as string;
		return fiwanoApiRequest.call(this, 'POST', '/messages/send', {
			channel_id: channelId,
			recipient,
			text,
		});
	}

	if (operation === 'sendTemplate') {
		const templateName = this.getNodeParameter('templateName', i) as string;
		const language = this.getNodeParameter('language', i) as string;
		const variablesRaw = this.getNodeParameter('variables', i) as string;
		const body: IDataObject = {
			channel_id: channelId,
			recipient,
			template_name: templateName,
			language,
		};
		if (variablesRaw && variablesRaw.trim() !== '') {
			try {
				body.variables = typeof variablesRaw === 'string'
					? JSON.parse(variablesRaw)
					: variablesRaw;
			} catch {
				throw new NodeOperationError(
					this.getNode(),
					'Variables must be a valid JSON object',
					{ itemIndex: i },
				);
			}
		}
		return fiwanoApiRequest.call(this, 'POST', '/messages/send-template', body);
	}

	if (operation === 'sendMedia') {
		const mediaType = this.getNodeParameter('mediaType', i) as string;
		const mediaUrl = this.getNodeParameter('mediaUrl', i) as string;
		const extra = this.getNodeParameter('mediaAdditionalFields', i) as IDataObject;
		const body: IDataObject = {
			channel_id: channelId,
			recipient,
			media_type: mediaType,
			media_url: mediaUrl,
		};
		if (extra.caption) body.caption = extra.caption;
		if (extra.filename) body.filename = extra.filename;
		return fiwanoApiRequest.call(this, 'POST', '/messages/send-media', body);
	}

	throw new NodeOperationError(this.getNode(), `Unknown message operation: ${operation}`);
}

// ── Template ─────────────────────────────────────────────────────────────────

async function executeTemplate(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject> {
	const channelId = this.getNodeParameter('channelId', i) as string;

	if (operation === 'getAll') {
		const filters = this.getNodeParameter('filters', i) as IDataObject;
		const qs: IDataObject = {};
		if (filters.status) qs.status = filters.status;
		if (filters.sync !== undefined) qs.sync = String(filters.sync);
		return fiwanoApiRequest.call(this, 'GET', `/channels/${channelId}/templates`, undefined, qs);
	}

	if (operation === 'get') {
		const templateId = this.getNodeParameter('templateId', i) as string;
		return fiwanoApiRequest.call(this, 'GET', `/channels/${channelId}/templates/${templateId}`);
	}

	if (operation === 'create') {
		const templateName = this.getNodeParameter('templateName', i) as string;
		const language = this.getNodeParameter('language', i) as string;
		const category = this.getNodeParameter('category', i) as string;
		const parameterFormat = this.getNodeParameter('parameterFormat', i) as string;
		const componentsRaw = this.getNodeParameter('components', i) as string;
		let components: unknown;
		try {
			components = typeof componentsRaw === 'string'
				? JSON.parse(componentsRaw)
				: componentsRaw;
		} catch {
			throw new NodeOperationError(
				this.getNode(),
				'Components must be a valid JSON array',
				{ itemIndex: i },
			);
		}
		const body: IDataObject = {
			name: templateName,
			language,
			category,
			components: components as IDataObject[],
		};
		if (parameterFormat) {
			body.parameter_format = parameterFormat;
		}
		return fiwanoApiRequest.call(this, 'POST', `/channels/${channelId}/templates`, body);
	}

	if (operation === 'update') {
		const templateId = this.getNodeParameter('templateId', i) as string;
		const componentsRaw = this.getNodeParameter('components', i) as string;
		let components: unknown;
		try {
			components = typeof componentsRaw === 'string'
				? JSON.parse(componentsRaw)
				: componentsRaw;
		} catch {
			throw new NodeOperationError(
				this.getNode(),
				'Components must be a valid JSON array',
				{ itemIndex: i },
			);
		}
		const updateCategory = this.getNodeParameter('updateCategory', i, '') as string;
		const updateBody: IDataObject = { components: components as IDataObject[] };
		if (updateCategory) {
			updateBody.category = updateCategory;
		}
		return fiwanoApiRequest.call(
			this,
			'PUT',
			`/channels/${channelId}/templates/${templateId}`,
			updateBody,
		);
	}

	if (operation === 'delete') {
		const templateId = this.getNodeParameter('templateId', i) as string;
		const allLanguages = this.getNodeParameter('allLanguages', i) as boolean;
		const qs: IDataObject = {};
		if (allLanguages) qs.all_languages = 'true';
		return fiwanoApiRequest.call(
			this,
			'DELETE',
			`/channels/${channelId}/templates/${templateId}`,
			undefined,
			qs,
		);
	}

	throw new NodeOperationError(this.getNode(), `Unknown template operation: ${operation}`);
}

// ── Contact ──────────────────────────────────────────────────────────────────

async function executeContact(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject> {
	if (operation === 'getProfile') {
		const channelId = this.getNodeParameter('channelId', i) as string;
		const userId = this.getNodeParameter('userId', i) as string;
		return fiwanoApiRequest.call(this, 'GET', `/channels/${channelId}/profile/${userId}`);
	}
	throw new NodeOperationError(this.getNode(), `Unknown contact operation: ${operation}`);
}

// ── Redirect ─────────────────────────────────────────────────────────────────

async function executeRedirect(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject> {
	if (operation === 'getAll') {
		return fiwanoApiRequest.call(this, 'GET', '/redirects');
	}
	if (operation === 'add') {
		const uriPattern = this.getNodeParameter('uriPattern', i) as string;
		return fiwanoApiRequest.call(this, 'POST', '/redirects', { uri_pattern: uriPattern });
	}
	if (operation === 'delete') {
		const redirectId = this.getNodeParameter('redirectId', i) as string;
		return fiwanoApiRequest.call(this, 'DELETE', `/redirects/${redirectId}`);
	}
	throw new NodeOperationError(this.getNode(), `Unknown redirect operation: ${operation}`);
}

/**
 * Read the optional default Webhook Secret stored on the Fiwano API credential.
 * Returns '' when no credential is attached or the field is empty. Used so the
 * Exchange OAuth Code / Update operations can fall back to a single
 * account-wide secret instead of requiring it on every node.
 */
async function credentialWebhookSecret(this: IExecuteFunctions): Promise<string> {
	try {
		const cred = await this.getCredentials('fiwanoApi');
		return (((cred?.webhookSecret as string) || '')).trim();
	} catch {
		return '';
	}
}
