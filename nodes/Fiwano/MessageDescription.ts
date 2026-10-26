import { INodeProperties } from 'n8n-workflow';

export const messageOperations: INodeProperties = {
	displayName: 'Operation',
	name: 'operation',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: ['message'] } },
	options: [
		{
			name: 'Send Interactive',
			value: 'sendInteractive',
			action: 'Send an interactive message',
			description: 'Send buttons, cards, quick replies or a list the user answers with a tap. Requires a Pro license; inside the 24h window.',
		},
		{
			name: 'Send Media',
			value: 'sendMedia',
			action: 'Send a media message',
			description: 'Send an image, audio, video, or document via URL. Requires a Pro license.',
		},
		{
			name: 'Send Template',
			value: 'sendTemplate',
			action: 'Send a template message',
			description: 'Send an approved WhatsApp template (Pro required; required outside the 24h window)',
		},
		{
			name: 'Send Text',
			value: 'send',
			action: 'Send a text message',
			description: 'Send a plain text message through any channel type',
		},
	],
	default: 'send',
};

export const messageFields: INodeProperties[] = [
	// ── Channel ID ───────────────────────────────────────────────────
	{
		displayName: 'Channel ID',
		name: 'channelId',
		type: 'string',
		default: '',
		required: true,
		description: 'The channel to send the message through',
		displayOptions: {
			show: { resource: ['message'] },
		},
	},

	// ── Recipient ────────────────────────────────────────────────────
	{
		displayName: 'Recipient',
		name: 'recipient',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. 1234567890',
		description: 'Phone number without + (WhatsApp), IGSID (Instagram), or PSID (Facebook)',
		hint: 'To reply, use {{ $json.data.from }} from a Fiwano Trigger',
		displayOptions: {
			show: { resource: ['message'] },
		},
	},

	// ── Send Text: Message Text ──────────────────────────────────────
	{
		displayName: 'Message Text',
		name: 'text',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		description: 'The text content of the message',
		displayOptions: {
			show: { resource: ['message'], operation: ['send'] },
		},
	},

	// ── Send Template: Template Name ─────────────────────────────────
	{
		displayName: 'Template Name',
		name: 'templateName',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'e.g. order_confirmation',
		description: 'Name of the approved WhatsApp template to send',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendTemplate'] },
		},
	},

	// ── Send Template: Language ──────────────────────────────────────
	{
		displayName: 'Language',
		name: 'language',
		type: 'string',
		default: 'en_US',
		required: true,
		placeholder: 'e.g. en_US',
		description: 'Language code matching the approved template version',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendTemplate'] },
		},
	},

	// ── Send Template: Variables ─────────────────────────────────────
	{
		displayName: 'Variables',
		name: 'variables',
		type: 'json',
		default: '',
		// Concatenated on purpose: the verification rule node-param-description-miscased-id
		// checks plain string literals and would "fix" the JSON key "id" to "ID".
		description:
			'Template variables as JSON. Positional: {"body":["val1","val2"]}. Named: {"body":{"name":"Pablo"}}. ' +
			'Authentication: {"body":["123456"]} — the code also fills the copy-code button. ' +
			'A quick-reply button\'s ID, returned as data.button_id on a tap: {"buttons":[{"index":0,"id":"confirm"}]}. ' +
			'Omit if no variables.',
		typeOptions: { rows: 4 },
		displayOptions: {
			show: { resource: ['message'], operation: ['sendTemplate'] },
		},
	},

	// ── Send Template: Optional Fields ───────────────────────────────
	{
		displayName: 'Additional Fields',
		name: 'templateAdditionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { resource: ['message'], operation: ['sendTemplate'] },
		},
		options: [
			{
				displayName: 'Header Media URL',
				name: 'headerMediaUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://my-bucket.s3.amazonaws.com/banner.jpg',
				description: 'HTTPS URL of the header image, video or document. Required when the template header is media (variables.header_media in Template → Get), not allowed otherwise. Meta downloads the file, as in Send Media.',
			},
		],
	},

	// ── Send Media: Media Type ────────────────────────────────────────
	{
		displayName: 'Media Type',
		name: 'mediaType',
		type: 'options',
		required: true,
		options: [
			{
				name: 'Audio',
				value: 'audio',
				description: 'WhatsApp, Instagram, Facebook',
			},
			{
				name: 'Document',
				value: 'document',
				description: 'WhatsApp, Instagram, Facebook',
			},
			{
				name: 'Image',
				value: 'image',
				description: 'WhatsApp, Instagram, Facebook',
			},
			{
				name: 'Sticker',
				value: 'sticker',
				description: 'WhatsApp (WebP file via Media URL), Facebook (Meta catalog Sticker ID); not on Instagram',
			},
			{
				name: 'Video',
				value: 'video',
				description: 'WhatsApp, Instagram, Facebook',
			},
		],
		default: 'image',
		description: 'Type of media to send. Not all types are supported on every channel.',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendMedia'] },
		},
	},

	// ── Send Media: Media URL ─────────────────────────────────────────
	{
		displayName: 'Media URL',
		name: 'mediaUrl',
		type: 'string',
		default: '',
		placeholder: 'https://my-bucket.s3.amazonaws.com/photo.jpg?X-Amz-Signature=...',
		description:
			'HTTPS URL of the media file. Meta fetches it directly — Fiwano does not store it. ' +
			'For non-public content use a signed URL (S3/GCS/R2 presigned, Azure SAS, or HMAC). ' +
			'Public URLs are accessible to anyone who learns them. Max 2048 chars; no credentials in URL; no private IPs. ' +
			'Required for every media type; for a Sticker it is the WhatsApp WebP file (512×512, ≤100 KB static / ≤500 KB animated) — leave it empty for a Facebook sticker and fill Sticker ID instead.',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendMedia'] },
		},
	},

	// ── Send Media: Sticker ID (Facebook Messenger) ───────────────────
	{
		displayName: 'Sticker ID',
		name: 'stickerId',
		type: 'string',
		default: '',
		placeholder: '369239263222822',
		description:
			'Facebook Messenger only: a sticker from Meta\'s catalog (369239263222822 is the thumbs up) ' +
			'or the data.media.sticker_id of a sticker a user sent you. Leave Media URL empty. ' +
			'On WhatsApp use Media URL with a WebP file instead.',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendMedia'], mediaType: ['sticker'] },
		},
	},

	// ── Send Media: Optional Fields ───────────────────────────────────
	{
		displayName: 'Additional Fields',
		name: 'mediaAdditionalFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: {
			show: { resource: ['message'], operation: ['sendMedia'] },
		},
		options: [
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				default: '',
				description: 'Caption text shown below the media. WhatsApp only (image, video, document).',
			},
			{
				displayName: 'Filename',
				name: 'filename',
				type: 'string',
				default: '',
				placeholder: 'e.g. invoice.pdf',
				description: 'Filename shown to recipient. WhatsApp document only.',
			},
		],
	},

	// ── Send Interactive: Type ───────────────────────────────────────────
	// Buttons and quick replies: fields in the editor, or a JSON array (a count
	// that comes from data or from an AI agent — a fixedCollection has a fixed
	// number of entries). Cards and list sections are nested, so JSON only,
	// like template components. The node only shapes the request: every channel
	// rule stays on the API, which answers 400 invalid_interactive_request
	// with a reason and a hint.
	{
		displayName: 'Type',
		name: 'interactiveType',
		type: 'options',
		options: [
			{
				name: 'Buttons',
				value: 'buttons',
				description: 'Text with 1–3 buttons under it. All channels.',
			},
			{
				name: 'Cards',
				value: 'cards',
				description: '1–10 cards with a picture, title and buttons; 2 or more scroll sideways. All channels.',
			},
			{
				name: 'List',
				value: 'list',
				description: 'WhatsApp only: text with a button that opens up to 10 options',
			},
			{
				name: 'Quick Replies',
				value: 'quickReplies',
				description: 'Instagram and Messenger only: text with up to 13 chips that disappear after a tap',
			},
		],
		default: 'buttons',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendInteractive'] },
		},
	},

	// ── Send Interactive: Text ───────────────────────────────────────────
	// Declared twice under one name: required where the API always needs it,
	// optional for cards. The value survives a change of Type.
	{
		displayName: 'Message Text',
		name: 'interactiveText',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		required: true,
		description: 'Text shown with the buttons, quick replies or list',
		displayOptions: {
			show: {
				resource: ['message'],
				operation: ['sendInteractive'],
				interactiveType: ['buttons', 'list', 'quickReplies'],
			},
		},
	},
	{
		displayName: 'Message Text',
		name: 'interactiveText',
		type: 'string',
		typeOptions: { rows: 4 },
		default: '',
		description:
			'WhatsApp: required for 2 or more cards (shown above them); with one card it is shown under the card title. ' +
			'Instagram and Messenger: leave it empty — cards carry no text there; send it first with Send Text.',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendInteractive'], interactiveType: ['cards'] },
		},
	},

	// ── Send Interactive: Fields or JSON ─────────────────────────────────
	{
		displayName: 'Specify Buttons',
		name: 'interactiveInput',
		type: 'options',
		options: [
			{ name: 'Using Fields Below', value: 'fields' },
			{
				name: 'Using JSON',
				value: 'json',
				description: 'A JSON array — for buttons built from data or chosen by an AI agent',
			},
		],
		default: 'fields',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendInteractive'], interactiveType: ['buttons'] },
		},
	},
	{
		displayName: 'Specify Quick Replies',
		name: 'interactiveInput',
		type: 'options',
		options: [
			{ name: 'Using Fields Below', value: 'fields' },
			{
				name: 'Using JSON',
				value: 'json',
				description: 'A JSON array — for quick replies built from data or chosen by an AI agent',
			},
		],
		default: 'fields',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendInteractive'], interactiveType: ['quickReplies'] },
		},
	},

	// ── Send Interactive: Buttons ────────────────────────────────────────
	{
		displayName: 'Buttons',
		name: 'interactiveButtons',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Button',
		default: {},
		description: '1–3 buttons. WhatsApp: reply buttons only, or exactly one URL button.',
		displayOptions: {
			show: {
				resource: ['message'],
				operation: ['sendInteractive'],
				interactiveType: ['buttons'],
				interactiveInput: ['fields'],
			},
		},
		options: [
			{
				displayName: 'Button',
				name: 'button',
				values: [
					{
						displayName: 'Button Type',
						name: 'type',
						type: 'options',
						options: [
							{
								name: 'Reply',
								value: 'reply',
								description: 'A tap sends the title back as message.received with data.button_id = ID',
							},
							{
								name: 'URL',
								value: 'url',
								description: 'Opens the link; no event is sent',
							},
						],
						default: 'reply',
					},
					{
						displayName: 'Title',
						name: 'title',
						type: 'string',
						default: '',
						placeholder: 'e.g. Confirm',
						description: 'Button label, one line, up to 20 characters. Reply titles must differ.',
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						default: '',
						placeholder: 'e.g. confirm:ORD-123',
						description: 'Your identifier, returned as data.button_id when the user taps (up to 256 characters, unique in the message)',
						displayOptions: { show: { type: ['reply'] } },
					},
					{
						displayName: 'URL',
						name: 'url',
						type: 'string',
						default: '',
						placeholder: 'e.g. https://shop.example.com/order/123',
						description: 'HTTPS link the button opens',
						displayOptions: { show: { type: ['url'] } },
					},
				],
			},
		],
	},

	// ── Send Interactive: Quick Replies ──────────────────────────────────
	{
		displayName: 'Quick Replies',
		name: 'interactiveQuickReplies',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true, sortable: true },
		placeholder: 'Add Quick Reply',
		default: {},
		description: '1–13 chips (Instagram and Messenger)',
		displayOptions: {
			show: {
				resource: ['message'],
				operation: ['sendInteractive'],
				interactiveType: ['quickReplies'],
				interactiveInput: ['fields'],
			},
		},
		options: [
			{
				displayName: 'Quick Reply',
				name: 'quickReply',
				values: [
					{
						displayName: 'Title',
						name: 'title',
						type: 'string',
						default: '',
						placeholder: 'e.g. Red',
						description: 'Chip label, one line, up to 20 characters. Titles must differ.',
					},
					{
						displayName: 'ID',
						name: 'id',
						type: 'string',
						default: '',
						placeholder: 'e.g. colour:red',
						description: 'Your identifier, returned as data.button_id when the user taps (up to 256 characters, unique in the message)',
					},
				],
			},
		],
	},

	// ── Send Interactive: Buttons / Quick Replies as JSON ────────────────
	// Descriptions are concatenated: node-param-description-miscased-id checks
	// plain string literals and would rewrite the JSON key "id" to "ID".
	{
		displayName: 'Buttons (JSON)',
		name: 'interactiveButtonsJson',
		type: 'json',
		default: '',
		typeOptions: { rows: 6 },
		description:
			'JSON array of 1–3 buttons: [{"type":"reply","id":"size:S","title":"S"},{"type":"url","title":"Size chart","url":"https://…"}]. ' +
			'A reply button\'s id comes back as data.button_id on a tap; titles up to 20 characters. ' +
			'WhatsApp: reply buttons only, or exactly one URL button.',
		displayOptions: {
			show: {
				resource: ['message'],
				operation: ['sendInteractive'],
				interactiveType: ['buttons'],
				interactiveInput: ['json'],
			},
		},
	},
	{
		displayName: 'Quick Replies (JSON)',
		name: 'interactiveQuickRepliesJson',
		type: 'json',
		default: '',
		typeOptions: { rows: 6 },
		description:
			'JSON array of 1–13 quick replies: [{"id":"colour:red","title":"Red"},{"id":"colour:blue","title":"Blue"}]. ' +
			'The id comes back as data.button_id on a tap; titles up to 20 characters.',
		displayOptions: {
			show: {
				resource: ['message'],
				operation: ['sendInteractive'],
				interactiveType: ['quickReplies'],
				interactiveInput: ['json'],
			},
		},
	},

	// ── Send Interactive: Cards ──────────────────────────────────────────
	{
		displayName: 'Cards',
		name: 'interactiveCards',
		type: 'json',
		default: '',
		typeOptions: { rows: 8 },
		description:
			'JSON array of 1–10 cards: [{"image_url":"https://…/item.jpg","title":"Rain Jacket","subtitle":"$89","buttons":[{"type":"reply","id":"add:SKU-1","title":"Add to cart"},{"type":"url","title":"View","url":"https://…"}]}]. ' +
			'image_url is an HTTPS JPEG or PNG that Meta downloads while sending; title and subtitle up to 80 characters; 1–3 buttons per card. ' +
			'WhatsApp: every card has the same buttons (one URL button each, or the same number of reply buttons).',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendInteractive'], interactiveType: ['cards'] },
		},
	},

	// ── Send Interactive: List ───────────────────────────────────────────
	{
		displayName: 'List Button',
		name: 'interactiveListButton',
		type: 'string',
		default: '',
		placeholder: 'e.g. Options',
		description: 'Label of the button that opens the list, up to 20 characters',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendInteractive'], interactiveType: ['list'] },
		},
	},
	{
		displayName: 'List Sections',
		name: 'interactiveListSections',
		type: 'json',
		default: '',
		typeOptions: { rows: 8 },
		description:
			'JSON array of sections: [{"title":"Delivery","rows":[{"id":"ship:express","title":"Express","description":"Tomorrow, $9"}]}]. ' +
			'Up to 10 rows across all sections; section and row titles up to 24 characters, description up to 72. ' +
			'A row\'s ID comes back as data.button_id when the user picks it.',
		displayOptions: {
			show: { resource: ['message'], operation: ['sendInteractive'], interactiveType: ['list'] },
		},
	},

	// ── Error on Failed Send ─────────────────────────────────────────────
	// The API answers HTTP 200 for every send and reports the outcome in
	// `success` / `status`. With this on, a `failed` outcome fails the node
	// (or lands on the error output under On Error → Continue), so a rejected
	// send can never pass as a green item. The default differs by node
	// version on purpose: nodes saved before 1.4.0 (typeVersion 1) keep the
	// legacy item-only behaviour they were built around; new nodes
	// (typeVersion 2) get the safe default. Same name, same semantics.
	{
		displayName: 'Error on Failed Send',
		name: 'errorOnSendFailure',
		type: 'boolean',
		default: true,
		description:
			'Whether to fail this node when Fiwano reports the send as failed (success: false, status: failed). ' +
			'Turn off to receive the failed send as a normal item and branch on success yourself. ' +
			'Sends Meta accepted (sent, queued) are never affected.',
		displayOptions: {
			show: { resource: ['message'], '@version': [2] },
		},
	},
	{
		displayName: 'Error on Failed Send',
		name: 'errorOnSendFailure',
		type: 'boolean',
		default: false,
		description:
			'Whether to fail this node when Fiwano reports the send as failed (success: false, status: failed). ' +
			'Off by default on nodes added before 1.4.0, where a failed send is returned as a normal item. ' +
			'Sends Meta accepted (sent, queued) are never affected.',
		displayOptions: {
			show: { resource: ['message'], '@version': [1] },
		},
	},
];
