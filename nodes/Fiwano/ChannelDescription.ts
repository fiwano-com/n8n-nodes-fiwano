import { INodeProperties } from 'n8n-workflow';

export const channelOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['channel'] } },
	options: [
		{
			name: 'Delete',
			value: 'delete',
			action: 'Delete a channel',
			description: 'Deactivate and remove a channel',
		},
		{
			name: 'Exchange OAuth Code',
			value: 'exchangeCode',
			action: 'Exchange an OAuth code for channel data',
			description: 'Exchange a one-time code from the OAuth redirect for channel data',
		},
		{
			name: 'Generate OAuth URL',
			value: 'setupUrl',
			action: 'Generate an OAuth setup URL',
			description: 'Generate a setup URL to connect a new channel (WhatsApp Embedded Signup or Meta OAuth; valid up to 60 min)',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get a channel',
			description: 'Retrieve details of a specific channel',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many channels',
			description: 'Retrieve all connected channels',
		},
		{
			name: 'Update Webhook',
			value: 'update',
			action: 'Update channel webhook settings',
			description: 'Update the webhook URL and/or secret for a channel',
		},
	],
	default: 'getAll',
};

export const channelFields: INodeProperties[] = [
	// ── Channel ID (get, update, delete) ─────────────────────────────
	{
		displayName: 'Channel ID',
		name: 'channelId',
		type: 'string',
		default: '',
		required: true,
		description: 'The channel ID (from Get Many or the Fiwano portal)',
		displayOptions: {
			show: { resource: ['channel'], operation: ['get', 'update', 'delete'] },
		},
	},

	// ── Generate OAuth URL ───────────────────────────────────────────
	{
		displayName: 'Channel Type',
		name: 'channelType',
		type: 'options',
		options: [
			{ name: 'WhatsApp', value: 'whatsapp' },
			{ name: 'Instagram', value: 'instagram' },
			{ name: 'Facebook Messenger', value: 'facebook' },
		],
		default: 'whatsapp',
		required: true,
		description: 'The type of channel to connect via OAuth',
		displayOptions: {
			show: { resource: ['channel'], operation: ['setupUrl'] },
		},
	},
	{
		displayName: 'Redirect URI',
		name: 'redirectUri',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://yourapp.com/callback',
		description: 'Where users land after OAuth — must be registered via Redirect URI → Add',
		displayOptions: {
			show: { resource: ['channel'], operation: ['setupUrl'] },
		},
	},

	// ── Exchange OAuth Code ──────────────────────────────────────────
	{
		displayName: 'OAuth Code',
		name: 'code',
		type: 'string',
		default: '',
		required: true,
		description: 'The one-time code from the OAuth redirect (?code=…). Expires in 5 minutes, single-use.',
		displayOptions: {
			show: { resource: ['channel'], operation: ['exchangeCode'] },
		},
	},
	{
		displayName: 'Additional Fields',
		name: 'additionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { resource: ['channel'], operation: ['exchangeCode'] },
		},
		options: [
			{
				displayName: 'Webhook URL',
				name: 'webhook_url',
				type: 'string',
				default: '',
				placeholder: 'https://your-n8n.example.com/webhook/…',
				description: 'HTTPS URL to receive webhook events. Can also be set later via Update Webhook.',
			},
			{
				displayName: 'Webhook Secret',
				name: 'webhook_secret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description: 'HMAC-SHA256 secret for signature verification. Auto-generated if omitted.',
			},
			{
				displayName: 'Webhook Events',
				name: 'webhook_events',
				type: 'multiOptions',
				default: [],
				description: 'Event types to deliver to the webhook URL. By default no events are enabled — you must select at least one to receive webhooks. Available events depend on the channel type.',
				options: [
					{ name: 'Message Received', value: 'message.received', description: 'Incoming message from a user (all channels)' },
					{ name: 'Message Sent', value: 'message.sent', description: 'Message accepted by Meta (WhatsApp only)' },
					{ name: 'Message Delivered', value: 'message.delivered', description: 'Message delivered to recipient (all channels)' },
					{ name: 'Message Read', value: 'message.read', description: 'Message read by recipient (all channels)' },
					{ name: 'Message Failed', value: 'message.failed', description: 'Message delivery failed (WhatsApp only)' },
				],
			},
		],
	},

	// ── Update Webhook ───────────────────────────────────────────────
	{
		displayName: 'Update Fields',
		name: 'updateFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { resource: ['channel'], operation: ['update'] },
		},
		options: [
			{
				displayName: 'Webhook URL',
				name: 'webhook_url',
				type: 'string',
				default: '',
				placeholder: 'https://your-n8n.example.com/webhook/…',
				description: 'New webhook URL for this channel',
			},
			{
				displayName: 'Webhook Secret',
				name: 'webhook_secret',
				type: 'string',
				typeOptions: { password: true },
				default: '',
				description: 'New HMAC-SHA256 secret. Auto-generated if URL is set and secret is omitted.',
			},
			{
				displayName: 'Webhook Events',
				name: 'webhook_events',
				type: 'multiOptions',
				default: [],
				description: 'Event types to deliver. Empty array disables all events. Available events depend on channel type.',
				options: [
					{ name: 'Message Received', value: 'message.received', description: 'Incoming message from a user (all channels)' },
					{ name: 'Message Sent', value: 'message.sent', description: 'Message accepted by Meta (WhatsApp only)' },
					{ name: 'Message Delivered', value: 'message.delivered', description: 'Message delivered to recipient (all channels)' },
					{ name: 'Message Read', value: 'message.read', description: 'Message read by recipient (all channels)' },
					{ name: 'Message Failed', value: 'message.failed', description: 'Message delivery failed (WhatsApp only)' },
				],
			},
		],
	},
];
