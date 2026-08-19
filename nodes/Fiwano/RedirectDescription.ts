import { INodeProperties } from 'n8n-workflow';

export const redirectOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['redirect'] } },
	options: [
		{
			name: 'Add',
			value: 'add',
			action: 'Add a redirect URI',
			description: 'Register an allowed OAuth redirect URI',
		},
		{
			name: 'Delete',
			value: 'delete',
			action: 'Delete a redirect URI',
			description: 'Remove an allowed redirect URI',
		},
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many redirects',
			description: 'List many allowed OAuth redirect URIs for your API key',
		},
	],
	default: 'getAll',
};

export const redirectFields: INodeProperties[] = [
	// ── URI Pattern (add) ────────────────────────────────────────────
	{
		displayName: 'URI Pattern',
		name: 'uriPattern',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://yourapp.com/callback',
		description:
			'HTTPS URL or wildcard pattern (e.g. https://*.example.com/callback). ' +
			'An exact URI is safest. Explicit ports 1-65535 are supported; loopback addresses are not. ' +
			'A wildcard may cover the path/query or one complete left-most hostname label, but cannot replace ' +
			'the whole hostname, part of a label, or the port. Embedded credentials, URL fragments, and the ' +
			'reserved query keys code, status, channel_type and error are rejected.',
		displayOptions: {
			show: { resource: ['redirect'], operation: ['add'] },
		},
	},

	// ── Redirect ID (delete) ─────────────────────────────────────────
	{
		displayName: 'Redirect ID',
		name: 'redirectId',
		type: 'string',
		default: '',
		required: true,
		description: 'The ID of the redirect URI entry to remove',
		displayOptions: {
			show: { resource: ['redirect'], operation: ['delete'] },
		},
	},
];
