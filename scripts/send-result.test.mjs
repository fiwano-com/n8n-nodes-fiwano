#!/usr/bin/env node
/**
 * Regression for the send-result helpers (GenericFunctions):
 * `isFailedSend`, `sendFailureHint`, `FiwanoSendFailedError`, `recipientProblem`,
 * plus the structured-detail rendering of `fiwanoApiError`.
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
	fiwanoApiError,
	isFailedSend,
	recipientProblem,
	sendFailureHint,
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

check('only the three send operations are classified', () => {
	assert.deepEqual([...SEND_OPERATIONS].sort(), ['send', 'sendMedia', 'sendTemplate']);
});

// ── sendFailureHint ──────────────────────────────────────────────────────────
check('known Meta codes get a hint, unknown ones none, string codes accepted', () => {
	assert.match(sendFailureHint(131047), /template/i);
	assert.match(sendFailureHint('131047'), /template/i);
	assert.match(sendFailureHint(551), /blocked/i);
	assert.match(sendFailureHint(10), /Business Settings/);
	assert.match(sendFailureHint(190), /Reconnect/);
	assert.match(sendFailureHint(133010), /WhatsApp Business App/);
	// 131057 is maintenance mode (retried by Fiwano), not the closed 24h window.
	assert.doesNotMatch(sendFailureHint(131057), /template|24-hour/i);
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

console.log(`   ${checks} checks passed`);
