import {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeOperationError,
} from 'n8n-workflow';

import { fiwanoApiRequest, fiwanoApiRequestBinary } from './GenericFunctions';
import { channelOperations, channelFields } from './ChannelDescription';
import { messageOperations, messageFields } from './MessageDescription';
import { templateOperations, templateFields } from './TemplateDescription';
import { contactOperations, contactFields } from './ContactDescription';
import { redirectOperations, redirectFields } from './RedirectDescription';
import { mediaOperations, mediaFields } from './MediaDescription';

export class Fiwano implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Fiwano',
		name: 'fiwano',
		icon: 'file:fiwano.svg',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Interact with Fiwano — unified API for WhatsApp, Instagram & Facebook Messenger',
		defaults: { name: 'Fiwano' },
		usableAsTool: true,
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'fiwanoApi', required: true }],
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
			...channelFields,
			...messageFields,
			...templateFields,
			...contactFields,
			...redirectFields,
			...mediaFields,
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

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
				} else if (resource === 'template') {
					responseData = await executeTemplate.call(this, operation, i);
				} else if (resource === 'contact') {
					responseData = await executeContact.call(this, operation, i);
				} else if (resource === 'redirect') {
					responseData = await executeRedirect.call(this, operation, i);
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
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				throw error;
			}
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
		return fiwanoApiRequest.call(this, 'POST', '/channels/exchange-code', body);
	}
	if (operation === 'update') {
		const channelId = this.getNodeParameter('channelId', i) as string;
		const fields = this.getNodeParameter('updateFields', i) as IDataObject;
		const body: IDataObject = {};
		if (fields.webhook_url) body.webhook_url = fields.webhook_url;
		// Secret: the explicit field wins; otherwise fall back to the credential's
		// default Webhook Secret when a webhook URL is being configured.
		const upSecret = (fields.webhook_secret as string)
			|| (fields.webhook_url ? await credentialWebhookSecret.call(this) : '');
		if (upSecret) body.webhook_secret = upSecret;
		if (fields.webhook_events) body.webhook_events = fields.webhook_events;
		return fiwanoApiRequest.call(this, 'PATCH', `/channels/${channelId}`, body);
	}
	if (operation === 'delete') {
		const channelId = this.getNodeParameter('channelId', i) as string;
		return fiwanoApiRequest.call(this, 'DELETE', `/channels/${channelId}`);
	}
	throw new NodeOperationError(this.getNode(), `Unknown channel operation: ${operation}`);
}

// ── Message ──────────────────────────────────────────────────────────────────

async function executeMessage(
	this: IExecuteFunctions,
	operation: string,
	i: number,
): Promise<IDataObject> {
	const channelId = this.getNodeParameter('channelId', i) as string;
	const recipient = this.getNodeParameter('recipient', i) as string;

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
 * Exchange OAuth Code / Update Webhook operations can fall back to a single
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
