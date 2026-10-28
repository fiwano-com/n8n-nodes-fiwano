#!/usr/bin/env node
/**
 * Regression for the send-result helpers (GenericFunctions):
 * `isFailedSend`, `sendFailureHint`, `FiwanoSendFailedError`, `recipientProblem`,
 * plus the structured-detail rendering of `fiwanoApiError` and the Media → Download
 * file name (`contentDispositionFilename`).
 *
 * These decide whether a rejected send turns the node red, what the error says,
 * and which recipients are refused before a request is made. The recipient
 * guard must stay a strict subset of the API's `invalid_recipient` preflight:
 * it may never refuse a value the API would accept.
 *
 * Run after `npm run build`.
 */

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { NodeOperationError } = require('n8n-workflow');
const {
	FiwanoSendFailedError,
	SEND_OPERATIONS,
	contentDispositionFilename,
	fiwanoApiError,
	interactiveBody,
	isFailedSend,
	pathSegment,
	recipientProblem,
	sendFailureHint,
	templateVariables,
} = require(join(ROOT, 'dist/nodes/Fiwano/GenericFunctions.js'));

const NODE = { name: 'Fiwano', type: 'fiwano', typeVersion: 2, position: [0, 0], parameters: {} };
let checks = 0;
const check = (label, fn) => {
	fn();
	checks += 1;
	console.log(`   ok — ${label}`);
};

// ── isFailedSend ─────────────────────────────────────────────────────────────
check('sent / queued are successes, failed is a failure', () => {
	assert.equal(isFailedSend({ success: true, status: 'sent' }), false);
	assert.equal(isFailedSend({ success: true, status: 'queued' }), false);
	assert.equal(isFailedSend({ success: false, status: 'failed', error: 'x' }), true);
	assert.equal(isFailedSend({ status: 'failed' }), true);
	assert.equal(isFailedSend({ success: false }), true);
	assert.equal(isFailedSend(undefined), false);
	assert.equal(isFailedSend({}), false);
});

check('only the four send operations are classified', () => {
	assert.deepEqual([...SEND_OPERATIONS].sort(), ['send', 'sendInteractive', 'sendMedia', 'sendTemplate']);
});

// ── sendFailureHint ──────────────────────────────────────────────────────────
check('known Meta codes get a hint, unknown ones none, string codes accepted', () => {
	assert.match(sendFailureHint(131047), /template/i);
	assert.match(sendFailureHint('131047'), /template/i);
	assert.match(sendFailureHint(551), /blocked/i);
	assert.match(sendFailureHint(10), /Business Settings/);
	// 10 has several causes; the hint must name the routing and 24h ones too.
	assert.match(sendFailureHint(10), /Default routing app/);
	assert.match(sendFailureHint(10), /24 hours/);
	assert.match(sendFailureHint(200), /Business Settings/);
	assert.doesNotMatch(sendFailureHint(200), /routing|24 hours/);
	assert.match(sendFailureHint(190), /Reconnect/);
	assert.match(sendFailureHint(133010), /WhatsApp Business App/);
	assert.match(sendFailureHint(131042), /Meta billing/);
	// 131057 is maintenance mode, not the closed 24h window. A `failed` with it
	// comes from Send Template (text/media are retried), so no "no action" advice.
	assert.doesNotMatch(sendFailureHint(131057), /template|24-hour|no action/i);
	assert.match(sendFailureHint(131056), /Wait/);
	assert.match(sendFailureHint(132000), /variables/);
	assert.match(sendFailureHint(132012), /variables/);
	assert.match(sendFailureHint(132001), /approved in this language/);
	assert.match(sendFailureHint(132015), /paused or disabled/);
	assert.match(sendFailureHint(132016), /paused or disabled/);
	assert.equal(sendFailureHint(424242), undefined);
	assert.equal(sendFailureHint(undefined), undefined);
	assert.equal(sendFailureHint(null), undefined);
});

// ── FiwanoSendFailedError ────────────────────────────────────────────────────
check('send failure error keeps the response and reads as Send failed: <meta text>', () => {
	const response = {
		success: false,
		message_id: 'uuid-1',
		error: '(#551) This person isn\'t available right now.',
		error_code: 551,
		status: 'failed',
	};
	const err = new FiwanoSendFailedError(NODE, response, 3);
	assert.ok(err instanceof NodeOperationError, 'must be a NodeOperationError so execute() re-throws it as-is');
	assert.equal(err.response, response);
	assert.match(err.message, /^Send failed: \(#551\) This person isn't available right now\. \(Meta error 551\)/);
	assert.match(err.description ?? '', /blocked/i);
});

check('send failure without error text or code still produces a usable message', () => {
	const err = new FiwanoSendFailedError(NODE, { success: false, status: 'failed' }, 0);
	assert.equal(err.message.startsWith('Send failed: Meta rejected the message'), true);
	assert.match(err.description ?? '', /did not retry/);
	assert.match(err.description ?? '', /Send Text, Send Media and Send Interactive/);
});

// ── recipientProblem — the strict subset of the API preflight ────────────────
check('empty and whitespace-only recipients are refused with the data.from hint', () => {
	for (const value of ['', '   ', '\n', undefined, null]) {
		const problem = recipientProblem(value);
		assert.ok(problem, `expected a problem for ${JSON.stringify(value)}`);
		assert.match(problem.message, /empty/);
		assert.match(problem.description, /\$json\.data\.from/);
	}
});

check('values without any digit are refused; object literals name the fix', () => {
	const obj = recipientProblem('[object Object]');
	assert.match(obj.message, /contains no digits/);
	assert.match(obj.description, /\{\{ \$json\.data\.from \}\} rather than \{\{ \$json\.data \}\}/);
	for (const value of ['undefined', 'null', 'John Doe', 'NaN']) {
		assert.match(recipientProblem(value).message, /contains no digits/, value);
	}
	const real = recipientProblem({ from: '123' });
	assert.match(real.message, /resolved to an object/);
});

check('anything the API might accept passes the local guard untouched', () => {
	for (const value of [
		'1234567890123456', // PSID / IGSID
		'5511999999999', // WhatsApp
		'+55 11 99999-9999', // formatting is Meta's call (API trims, Meta normalizes)
		' 1234567890123456\n', // surrounding whitespace is trimmed server-side
		'psid_123', // wrong for FB/IG, but that rule lives on the API (needs channel type)
		'1',
		42, // a number from an expression is still a digit string
	]) {
		assert.equal(recipientProblem(value), undefined, JSON.stringify(value));
	}
});

// ── fiwanoApiError with a structured detail ──────────────────────────────────
check('structured 400 detail renders its message and hint, not raw JSON', () => {
	const e = new Error('Request failed with status code 400');
	e.isAxiosError = true;
	e.response = {
		status: 400,
		data: {
			detail: {
				code: 'invalid_recipient',
				reason: 'empty',
				message: 'Recipient is empty. Expected a numeric PSID.',
				channel_type: 'facebook',
				hint: "Set 'recipient' to the user's PSID.",
			},
		},
		headers: {},
	};
	const mapped = fiwanoApiError(NODE, e, 'fallback');
	assert.equal(mapped.message, 'Fiwano API error (HTTP 400): Recipient is empty. Expected a numeric PSID.');
	assert.equal(mapped.description, "Set 'recipient' to the user's PSID.");
	assert.equal(mapped.httpCode, '400');
});

check('structured detail without message still falls back to JSON, without hint falls back to status hint', () => {
	const e = new Error('Request failed with status code 402');
	e.isAxiosError = true;
	e.response = { status: 402, data: { detail: { code: 'pro_required' } }, headers: {} };
	const mapped = fiwanoApiError(NODE, e, 'fallback');
	assert.equal(mapped.message, 'Fiwano API error (HTTP 402): {"code":"pro_required"}');
	assert.match(mapped.description ?? '', /subscription/i);
});

// ── pathSegment ──────────────────────────────────────────────────────────────
check('path IDs: valid IDs unchanged, whitespace trimmed, URL syntax encoded', () => {
	for (const id of ['a1b2c3d4e5f67890', '6543217890123456', '1234567890123', 'm1b2c3d4e5f67890']) {
		assert.equal(pathSegment(id), id);
	}
	assert.equal(pathSegment('  a1b2c3d4e5f67890\n'), 'a1b2c3d4e5f67890');
	assert.equal(pathSegment('abc?x=1#y'), 'abc%3Fx%3D1%23y');
	assert.equal(pathSegment('a/b'), 'a%2Fb');
	// Non-strings render exactly as the template literal did before.
	assert.equal(pathSegment(123), '123');
	assert.equal(pathSegment(undefined), 'undefined');
});

// ── templateVariables ────────────────────────────────────────────────────────
check('template variables: string parsed, object passed, empty omitted, junk invalid', () => {
	assert.deepEqual(templateVariables(''), {});
	assert.deepEqual(templateVariables('   '), {});
	assert.deepEqual(templateVariables(undefined), {});
	assert.deepEqual(templateVariables('{"body":["a"]}'), { value: { body: ['a'] } });
	const obj = { body: { name: 'Pablo' } };
	assert.deepEqual(templateVariables(obj), { value: obj });
	assert.deepEqual(templateVariables('{not json'), { invalid: true });
	assert.deepEqual(templateVariables(42), { invalid: true });
});

// ── interactiveBody ──────────────────────────────────────────────────────────
check('interactive buttons: each type sends only its own field, text kept as typed', () => {
	const { body, problem } = interactiveBody({
		type: 'buttons',
		text: 'Which size?',
		buttons: {
			button: [
				{ type: 'reply', id: 'size:S', title: 'S', url: 'https://stale.example' },
				{ type: 'url', id: 'stale', title: 'Size chart', url: ' https://shop.example/chart ' },
			],
		},
	});
	assert.equal(problem, undefined);
	assert.deepEqual(body, {
		text: 'Which size?',
		buttons: [
			{ type: 'reply', title: 'S', id: 'size:S' },
			{ type: 'url', title: 'Size chart', url: 'https://shop.example/chart' },
		],
	});
});

check('interactive: blank text is omitted (cards on IG/FB take none), empty collections refused', () => {
	const cards = [{ image_url: 'https://x/a.jpg', title: 'A', buttons: [{ type: 'url', title: 'Go', url: 'https://x' }] }];
	assert.deepEqual(interactiveBody({ type: 'cards', text: '  ', cards: JSON.stringify(cards) }).body, { cards });
	assert.deepEqual(interactiveBody({ type: 'cards', text: undefined, cards }).body, { cards });
	assert.match(interactiveBody({ type: 'buttons', text: 'x', buttons: {} }).problem, /at least one button/);
	assert.match(interactiveBody({ type: 'quickReplies', text: 'x', quickReplies: { quickReply: [] } }).problem, /at least one quick reply/);
});

check('interactive quick replies and list map to the API shape', () => {
	assert.deepEqual(
		interactiveBody({ type: 'quickReplies', text: 'Colour?', quickReplies: { quickReply: [{ title: 'Red', id: 'c:red' }] } }).body,
		{ text: 'Colour?', quick_replies: [{ id: 'c:red', title: 'Red' }] },
	);
	const sections = [{ title: 'Delivery', rows: [{ id: 'ship:x', title: 'Express' }] }];
	assert.deepEqual(
		interactiveBody({ type: 'list', text: 'How?', listButton: 'Options', listSections: JSON.stringify(sections) }).body,
		{ text: 'How?', list: { button: 'Options', sections } },
	);
});

check('interactive buttons / quick replies as JSON: string parsed, array from an expression passed as is', () => {
	const buttons = [{ type: 'reply', id: 'size:S', title: 'S' }];
	assert.deepEqual(
		interactiveBody({ type: 'buttons', input: 'json', text: 'Size?', buttons: JSON.stringify(buttons) }).body,
		{ text: 'Size?', buttons },
	);
	const quickReplies = [{ id: 'c:red', title: 'Red' }, { id: 'c:blue', title: 'Blue' }];
	assert.deepEqual(
		interactiveBody({ type: 'quickReplies', input: 'json', text: 'Colour?', quickReplies }).body,
		{ text: 'Colour?', quick_replies: quickReplies },
	);
	assert.match(interactiveBody({ type: 'buttons', input: 'json', text: 'x', buttons: '' }).problem, /Buttons must be a non-empty JSON array/);
	assert.match(interactiveBody({ type: 'quickReplies', input: 'json', text: 'x', quickReplies: '{}' }).problem, /Quick Replies must be a non-empty JSON array/);
	// Fields mode stays the default when the mode is absent.
	assert.match(interactiveBody({ type: 'buttons', text: 'x', buttons: '[]' }).problem, /at least one button/);
});

check('interactive JSON fields: invalid, non-array or empty input is refused with an example', () => {
	for (const cards of ['', '{not json', '{"title":"x"}', '[]', 42, { a: 1 }]) {
		assert.match(interactiveBody({ type: 'cards', text: '', cards }).problem, /Cards must be a non-empty JSON array/);
	}
	assert.match(interactiveBody({ type: 'list', text: 'x', listButton: 'O', listSections: '' }).problem, /List Sections/);
	assert.match(interactiveBody({ type: 'carousel', text: 'x' }).problem, /Unknown interactive type/);
});

check('media download name: filename* wins over the ASCII fallback, both forms of the API header', () => {
	// The API's two shapes (GET /media/{id}): a name that needs no encoding, and
	// an ASCII fallback followed by the exact UTF-8 name.
	assert.equal(contentDispositionFilename('attachment; filename="data.json"'), 'data.json');
	assert.equal(
		contentDispositionFilename(
			"attachment; filename=\"____ ____ (1).docx\"; filename*=utf-8''%D1%82%D0%B5%D1%81%D1%82%20%D1%84%D0%B0%D0%B9%D0%BB%20%281%29.docx",
		),
		'тест файл (1).docx',
	);
	// The API before the fallback was added sent filename* alone.
	assert.equal(contentDispositionFilename("attachment; filename*=utf-8''%D1%82%D0%B5%D1%81%D1%82-1.pdf"), 'тест-1.pdf');
	// Order does not matter, the parameter name is case-insensitive, spaces around `=` are allowed.
	assert.equal(contentDispositionFilename("attachment; FILENAME*= UTF-8''a%20b.txt; filename=a_b.txt"), 'a b.txt');
	assert.equal(contentDispositionFilename("attachment; filename*=iso-8859-1'en'caf%E9.txt"), 'café.txt');
	// A quoted value may contain `;` and escaped quotes.
	assert.equal(contentDispositionFilename('attachment; filename="a;b \\"c\\".txt"'), 'a;b "c".txt');
	assert.equal(contentDispositionFilename('attachment; filename=plain.pdf'), 'plain.pdf');
	// Broken or unknown filename* falls back to filename.
	assert.equal(contentDispositionFilename("attachment; filename=\"x.pdf\"; filename*=utf-8''%E0%A4%A.pdf"), 'x.pdf');
	assert.equal(contentDispositionFilename("attachment; filename=\"x.pdf\"; filename*=koi8-r''%D4.pdf"), 'x.pdf');
	for (const none of [undefined, '', 'attachment', 'inline', 'attachment; filename=""', 42, ['attachment; filename=a']]) {
		assert.equal(contentDispositionFilename(none), undefined);
	}
});

console.log(`   ${checks} checks passed`);
