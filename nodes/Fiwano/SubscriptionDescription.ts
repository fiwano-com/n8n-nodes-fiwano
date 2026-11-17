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

export const subscriptionFields: INodeProperties[] = [
	{
		displayName: 'Filters',
		name: 'filters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: {
			show: { resource: ['subscription'], operation: ['getAll'] },
		},
		options: [
			{
				displayName: 'Status',
				name: 'status',
				type: 'multiOptions',
				options: [
					{
						name: 'Active',
						value: 'active',
						description: 'Can carry channels',
					},
					{ name: 'Canceled', value: 'canceled' },
					{ name: 'Expired', value: 'expired' },
				],
				default: ['active'],
				description:
					'Return only subscriptions with these statuses; leave empty for all. Active Total and Available Slots always cover the whole account.',
			},
		],
	},
];
