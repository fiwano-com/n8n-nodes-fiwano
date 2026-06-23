import { INodeProperties } from 'n8n-workflow';

export const templateOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['template'] } },
	options: [
		{
			name: 'Create',
			value: 'create',
			action: 'Create a template',
			description: 'Create a new WhatsApp message template (Pro required; submitted to Meta for review)',
		},
		{
			name: 'Delete',
			value: 'delete',
			action: 'Delete a template',
			description: 'Delete a WhatsApp message template (Pro required)',
		},
		{
			name: 'Get',
			value: 'get',
			action: 'Get a template',
			description: 'Get details of a specific WhatsApp template (Pro required)',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many templates',
			description: 'List WhatsApp templates for a channel (Pro required)',
		},
		{
			name: 'Update',
			value: 'update',
			action: 'Update a template',
			description: 'Update an existing WhatsApp template (Pro required; re-submitted for review)',
		},
	],
	default: 'getAll',
};

export const templateFields: INodeProperties[] = [
	// ── Channel ID (all template operations) ─────────────────────────
	{
		displayName: 'Channel ID',
		name: 'channelId',
		type: 'string',
		default: '',
		required: true,
		description: 'The WhatsApp channel ID',
		displayOptions: {
			show: { resource: ['template'] },
		},
	},

	// ── Template ID (get, update, delete) ────────────────────────────
	{
		displayName: 'Template ID',
		name: 'templateId',
		type: 'string',
		default: '',
		required: true,
		description: 'The ID of the template',
		displayOptions: {
			show: { resource: ['template'], operation: ['get', 'update', 'delete'] },
		},
	},

	// ── Get Many: Filters ────────────────────────────────────────────
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: { resource: ['template'], operation: ['getAll'] },
		},
		options: [
			{
				displayName: 'Status',
				name: 'status',
				type: 'options',
				options: [
					{ name: 'All', value: '' },
					{ name: 'Approved', value: 'APPROVED' },
					{ name: 'Pending', value: 'PENDING' },
					{ name: 'Rejected', value: 'REJECTED' },
				],
				default: '',
				description: 'Filter templates by approval status',
			},
			{
				displayName: 'Sync from Meta',
				name: 'sync',
				type: 'boolean',
				default: true,
				description: 'Whether to fetch the latest state from Meta before returning',
			},
		],
	},

	// ── Create: Template Name ────────────────────────────────────────
	{
		displayName: 'Template Name',
		name: 'templateName',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. order_confirmation',
		description: 'Lowercase alphanumeric with underscores, max 512 chars',
		displayOptions: {
			show: { resource: ['template'], operation: ['create'] },
		},
	},

	// ── Create: Language ─────────────────────────────────────────────
	{
		displayName: 'Language',
		name: 'language',
		type: 'string',
		default: 'en_US',
		required: true,
		placeholder: 'e.g. en_US',
		description: 'Language code for this template',
		displayOptions: {
			show: { resource: ['template'], operation: ['create'] },
		},
	},

	// ── Create: Category ─────────────────────────────────────────────
	{
		displayName: 'Category',
		name: 'category',
		type: 'options',
		options: [
			{ name: 'Marketing', value: 'MARKETING' },
			{ name: 'Utility', value: 'UTILITY' },
			{ name: 'Authentication', value: 'AUTHENTICATION' },
		],
		default: 'UTILITY',
		required: true,
		description: 'Template category as required by Meta',
		displayOptions: {
			show: { resource: ['template'], operation: ['create'] },
		},
	},

	// ── Create/Update: Components ────────────────────────────────────
	{
		displayName: 'Components (JSON)',
		name: 'components',
		type: 'json',
		default: '[\n  {\n    "type": "BODY",\n    "text": "Hello {{1}}!",\n    "example": { "body_text": [["World"]] }\n  }\n]',
		required: true,
		description: 'Template components as JSON array. BODY is required. HEADER (text only), FOOTER, BUTTONS optional. Include "example" for Meta review.',
		displayOptions: {
			show: { resource: ['template'], operation: ['create', 'update'] },
		},
	},

	// ── Update: Category ─────────────────────────────────────────────
	{
		displayName: 'Category',
		name: 'updateCategory',
		type: 'options',
		options: [
			{ name: 'Keep Current', value: '' },
			{ name: 'Marketing', value: 'MARKETING' },
			{ name: 'Utility', value: 'UTILITY' },
			{ name: 'Authentication', value: 'AUTHENTICATION' },
		],
		default: '',
		description:
			'Change the template category. Meta only permits this for REJECTED or PAUSED templates; for an APPROVED template leave it as "Keep Current".',
		displayOptions: {
			show: { resource: ['template'], operation: ['update'] },
		},
	},

	// ── Create: Parameter Format ─────────────────────────────────────
	{
		displayName: 'Parameter Format',
		name: 'parameterFormat',
		type: 'options',
		options: [
			{
				name: 'Positional ({{1}}, {{2}})',
				value: 'positional',
				description: 'Variables referenced by index',
			},
			{
				name: 'Named ({{customer_name}})',
				value: 'named',
				description: 'Variables referenced by name',
			},
		],
		default: 'positional',
		description: 'How template variables are referenced in the component text',
		displayOptions: {
			show: { resource: ['template'], operation: ['create'] },
		},
	},

	// ── Delete: All Languages ────────────────────────────────────────
	{
		displayName: 'Delete All Languages',
		name: 'allLanguages',
		type: 'boolean',
		default: false,
		description: 'Whether to delete all language versions of this template (not just the one matching this ID)',
		displayOptions: {
			show: { resource: ['template'], operation: ['delete'] },
		},
	},
];
