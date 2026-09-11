#!/usr/bin/env node
/**
 * Regression for `fiwanoApiError` (GenericFunctions).
 *
 * The mapper runs inside a `catch`, so a throw of its own would replace the real
 * API failure with a serialisation error and lose the cause. It also has to cope
 * with every shape the HTTP layer may hand it — which is NOT just "an axios
 * error": n8n often wraps it in a NodeApiError first, and that wrapper drops
 * `cause`/`errorResponse`/`response`, keeping the body only in `context.data`.
 *
 * Run after `npm run build`.
 */

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { NodeApiError } = require('n8n-workflow');
const { fiwanoApiError } = require(join(ROOT, 'dist/nodes/Fiwano/GenericFunctions.js'));

const NODE = { name: 'Fiwano', type: 'fiwano', typeVersion: 1, position: [0, 0], parameters: {} };

const axiosError = (status, data, headers) => {
	const e = new Error(`Request failed with status code ${status}`);
	e.name = 'AxiosError';
	e.isAxiosError = true;
	e.response = { status, data, headers: headers ?? {} };
	return e;
};

const circular = { detail: { code: 'text_too_long' } };
circular.detail.self = circular;
const econn = Object.assign(new Error('connect ECONNREFUSED 1.2.3.4:443'), { code: 'ECONNREFUSED' });

const SLOT = 'Subscription a1b2 already has a whatsapp channel (c3d4). Unbind or delete that channel first.';
const NO_FREE_SLOT = {
	code: 'no_free_slot',
	message: 'Every active subscription already has a WhatsApp channel bound to it.',
	occupied_by: ['chan_a1b2', 'chan_c3d4'],
	hint: 'Reconnect one of these channels instead, release its slot (DELETE /api/v1/channels/{id}, then PATCH it with subscription_id ""), or add a subscription.',
};

/**
 * `expect` fields:
 *   contains   — substring the message must carry (the actionable reason)
 *   status     — HTTP status the message must report, or null for none
 *   transport  — n8n intentionally replaces our message with its own network
 *                diagnosis, so the "Fiwano API error" prefix is not expected
 */
const CASES = [
	['raw axios 400 (slot conflict)', axiosError(400, { detail: SLOT }), { contains: SLOT, status: 400 }],
	['n8n-WRAPPED 400 (body only in context.data)', new NodeApiError(NODE, axiosError(400, { detail: SLOT })), { contains: SLOT, status: 400 }],
	['n8n-WRAPPED 402', new NodeApiError(NODE, axiosError(402, { detail: 'No active subscription' })), { contains: 'No active subscription', status: 402 }],
	['409 structured no_free_slot (setup-url)', axiosError(409, { detail: NO_FREE_SLOT }), { contains: 'Slots held by: chan_a1b2, chan_c3d4', status: 409, description: 'subscription_id' }],
	['409 plain string falls back to the status hint', axiosError(409, { detail: 'Conflict' }), { contains: 'Conflict', status: 409, description: 'Release Subscription Slot' }],
	['422 field list flattened', axiosError(422, { detail: [{ loc: ['body', 'text'], msg: 'Message text cannot be empty' }] }), { contains: 'text: Message text cannot be empty', status: 422 }],
	['429 with Retry-After', axiosError(429, { detail: 'Rate limit exceeded' }, { 'retry-after': '3' }), { contains: 'Rate limit exceeded', status: 429, description: 'Retry after 3s' }],
	['410 arraybuffer body (media download)', axiosError(410, Buffer.from(JSON.stringify({ detail: 'Media expired' }))), { contains: 'Media expired', status: 410 }],
	['400 unparsed string body', axiosError(400, JSON.stringify({ detail: 'Subscription not active' })), { contains: 'Subscription not active', status: 400 }],
	['500 oversized buffer is dropped', axiosError(500, Buffer.alloc(3 * 1024 * 1024, 7)), { status: 500, noHeavyPayload: true }],
	['502 HTML body', axiosError(502, '<html>Bad Gateway</html>'), { status: 502 }],
	['400 array body rejected', axiosError(400, [1, 2, 3]), { status: 400 }],
	['400 truncated JSON', axiosError(400, '{"detail": "unterminated'), { status: 400 }],
	['circular detail does not throw', axiosError(400, circular), { status: 400 }],
	['Meta error code must not become an HTTP status', { httpCode: 131047, message: 'x' }, { status: null }],
	['bogus status string', { response: { status: 'nope' } }, { status: null }],
	['plain Error', new Error('socket hang up'), { status: null }],
	['ECONNREFUSED raw', econn, { transport: true }],
	['ECONNREFUSED wrapped', new NodeApiError(NODE, econn), { transport: true }],
	['string thrown', 'boom', { status: null }],
	['null thrown', null, { status: null }],
	['undefined thrown', undefined, { status: null }],
	['number thrown', 42, { status: null }],
	['empty object', {}, { status: null }],
];

let failed = 0;
const fail = (name, why) => { failed++; console.error(`  ✗ ${name}\n      ${why}`); };

for (const [name, input, expect] of CASES) {
	let err;
	try {
		err = fiwanoApiError(NODE, input, 'API request failed');
	} catch (thrown) {
		fail(name, `mapper THREW: ${thrown?.message}`);
		continue;
	}

	if (!(err instanceof NodeApiError)) { fail(name, 'did not return a NodeApiError'); continue; }
	if (typeof err.message !== 'string' || !err.message) { fail(name, 'empty message'); continue; }

	if (!expect.transport && !err.message.startsWith('Fiwano API error')) {
		fail(name, `lost the "Fiwano API error" prefix: ${err.message}`);
	}
	if (expect.contains && !err.message.includes(expect.contains)) {
		fail(name, `message lost the reason.\n      want substring: ${expect.contains}\n      got: ${err.message}`);
	}

	const reported = err.message.match(/HTTP (\d+)/)?.[1];
	if (expect.status === null && reported) fail(name, `reported a status it should not have: HTTP ${reported}`);
	if (typeof expect.status === 'number' && Number(reported) !== expect.status) {
		fail(name, `expected HTTP ${expect.status}, got ${reported ?? 'none'}`);
	}
	if (reported && (Number(reported) < 100 || Number(reported) > 599)) {
		fail(name, `printed an out-of-range HTTP status: ${reported}`);
	}
	if (expect.description && !(err.description ?? '').includes(expect.description)) {
		fail(name, `description missing "${expect.description}" (got: ${err.description})`);
	}
	if (expect.noHeavyPayload) {
		const kept = err.context?.data ?? err.errorResponse;
		if (Buffer.isBuffer(kept) || (typeof kept === 'string' && kept.length > 4096)) {
			fail(name, 'retained a heavy payload — it would land in the execution log');
		}
	}
}

if (failed) {
	console.error(`\nerror-mapper: ${failed} failure(s) out of ${CASES.length}`);
	process.exit(1);
}
console.log(`error-mapper: ${CASES.length}/${CASES.length} shapes OK (no throws, no lost reasons, no bogus statuses).`);
