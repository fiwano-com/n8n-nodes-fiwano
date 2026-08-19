import {
	Icon,
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

export class FiwanoApi implements ICredentialType {
	name = 'fiwanoApi';
	displayName = 'Fiwano API';
	icon: Icon = {
		light: 'file:../nodes/Fiwano/fiwano.svg',
		dark: 'file:../nodes/Fiwano/fiwano.dark.svg',
	};
	// `-miscased` wants a camelCase slug, which is right for n8n's own credentials
	// (they point at n8n doc pages). A community node must link to its live external
	// docs — that is an n8n verification requirement — so the two rules conflict here
	// and the real URL wins.
	// eslint-disable-next-line n8n-nodes-base/cred-class-field-documentation-url-miscased
	documentationUrl = 'https://fiwano.com/documentation';
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'mip_live_...',
			hint: 'Your Fiwano API key starting with mip_live_',
		},
		{
			displayName: 'Webhook Secret',
			name: 'webhookSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description:
				'Optional. A default HMAC-SHA256 webhook secret reused across this account. The Fiwano Trigger uses it (when its own Webhook Secret field is empty) to verify incoming signatures and, in auto-setup mode, to register on your channels. The Exchange OAuth Code / Update operations also fall back to it when you leave their secret empty. Leave blank if you set secrets per-operation instead.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'X-API-Key': '={{$credentials.apiKey}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://fiwano.com',
			url: '/api/v1/channels',
			method: 'GET',
		},
	};
}
