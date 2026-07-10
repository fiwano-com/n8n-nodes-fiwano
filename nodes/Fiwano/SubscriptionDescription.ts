import { INodeProperties } from 'n8n-workflow';

export const subscriptionOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['subscription'] } },
	options: [
		{
			name: 'Get Many',
			value: 'getAll',
			action: 'Get many subscriptions',
			description: 'Retrieve subscriptions and available channel slots',
		},
	],
	default: 'getAll',
};

export const subscriptionFields: INodeProperties[] = [];
