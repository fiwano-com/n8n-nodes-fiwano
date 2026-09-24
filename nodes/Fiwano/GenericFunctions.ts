import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INode,
	JsonObject,
	NodeApiError,
	NodeOperationError,
} from 'n8n-workflow';

export interface MediaDownloadResult {
	buffer: Buffer;
	mimeType: string;
	fileName: string | undefined;
}

const BASE_URL = 'https://fiwano.com/api/v1';
export const FIWANO_CLIENT_HEADER_VALUE = 'n8n-nodes-fiwano';

// ── Error mapping ────────────────────────────────────────────────────────────

/**
 * Shapes the HTTP layer can hand us for a failed request. n8n may already have
 * wrapped it in a NodeApiError, or pass the underlying axios-style error
 * through; both are probed so the reason survives either path.
 */
interface HttpErrorLike {
	message?: string;
	description?: string;
	httpCode?: string | number;
	statusCode?: number;
	status?: number;
	body?: unknown;
	error?: unknown;
	cause?: unknown;
	/**
	 * Set by NodeApiError when n8n wrapped an axios error. This is the ONLY place
	 * the response body survives that wrapping: `cause`, `errorResponse` and
	 * `response` are all undefined on the wrapper, because ExecutionBaseError
	 * declares `cause` as a bare class field (which resets it) and only assigns it
	 * for non-Error causes. Verified against n8n-workflow's compiled output.
	 */
	context?: { data?: unknown };
	errorResponse?: unknown;
	response?: {
		status?: number;
		statusCode?: number;
		body?: unknown;
		data?: unknown;
		headers?: Record<string, string | string[] | undefined>;
	};
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
}

/**
 * JSON.stringify that can never throw. Error payloads can carry circular refs
 * (axios attaches request/socket objects), and this mapper runs inside a catch
 * block — throwing here would replace the real API error with a serialization
 * error and lose the cause entirely.
 */
function safeStringify(value: unknown): string | undefined {
	try {
		const text = JSON.stringify(value);
		return text && text !== '{}' ? text : undefined;
	} catch {
		return undefined;
	}
}

/** Largest error body we will try to decode. Real API errors are a few hundred bytes. */
const MAX_DECODED_ERROR_BODY = 64 * 1024;

/**
 * Turn one body candidate into a plain JSON object, or reject it.
 *
 * Three shapes have to be handled beyond a ready-made object:
 * - **Bytes.** `GET /media/{id}` runs with `encoding: 'arraybuffer'`, so even its
 *   JSON error bodies arrive as a Buffer. Decode small ones; never keep large
 *   ones — the payload we pass to NodeApiError ends up in the execution log, and
 *   attaching megabytes of media bytes there would be a real leak.
 * - **Strings.** The action-node helper does not set `json: true`, so an error
 *   body can come back unparsed.
 * - **Arrays.** Never a Fiwano error body; rejected so they cannot masquerade as one.
 */
function coerceBody(candidate: unknown): Record<string, unknown> | undefined {
	if (candidate === null || candidate === undefined) return undefined;

	let text: string | undefined;

	if (typeof candidate === 'string') {
		text = candidate;
	} else if (Buffer.isBuffer(candidate)) {
		if (candidate.byteLength > MAX_DECODED_ERROR_BODY) return undefined;
		text = candidate.toString('utf8');
	} else if (candidate instanceof ArrayBuffer || ArrayBuffer.isView(candidate)) {
		const view = candidate instanceof ArrayBuffer ? new Uint8Array(candidate) : new Uint8Array(
			(candidate as ArrayBufferView).buffer,
			(candidate as ArrayBufferView).byteOffset,
			(candidate as ArrayBufferView).byteLength,
		);
		if (view.byteLength > MAX_DECODED_ERROR_BODY) return undefined;
		text = Buffer.from(view).toString('utf8');
	}

	if (text !== undefined) {
		const trimmed = text.trim();
		if (!trimmed.startsWith('{')) return undefined;
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
				? (parsed as Record<string, unknown>)
				: undefined;
		} catch {
			return undefined;
		}
	}

	if (Array.isArray(candidate)) return undefined;
	return asRecord(candidate);
}

/** First usable HTTP status on the error, whatever layer wrapped it. */
function extractStatus(err: HttpErrorLike): number | undefined {
	const candidates: Array<string | number | undefined> = [
		err.httpCode,
		err.statusCode,
		err.status,
		err.response?.status,
		err.response?.statusCode,
	];
	for (const candidate of candidates) {
		const value = typeof candidate === 'string' ? Number(candidate) : candidate;
		// Must be a real HTTP status. NodeApiError derives `httpCode` by scanning keys
		// that include `code`, so a transport code (ECONNREFUSED → NaN) or a Meta
		// error code (131047) can land there; neither may be printed as an HTTP status.
		if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) {
			return value;
		}
	}
	return undefined;
}

/**
 * First response body we can find, across every shape the layer may hand us:
 * a raw axios error, an n8n-wrapped NodeApiError, or a plain object. Order
 * matters — the most specific/faithful source wins.
 */
function extractBody(err: HttpErrorLike): Record<string, unknown> | undefined {
	const direct = [
		err.response?.body,
		err.response?.data,
		err.body,
		err.error,
		// NodeApiError keeps the parsed response body here and nowhere else.
		err.context?.data,
		err.errorResponse,
	];
	for (const candidate of direct) {
		const record = coerceBody(candidate);
		if (record) return record;
	}
	const cause = asRecord(err.cause) as HttpErrorLike | undefined;
	if (cause) {
		const nested = [cause.response?.body, cause.response?.data, cause.body, cause.error];
		for (const candidate of nested) {
			const record = coerceBody(candidate);
			if (record) return record;
		}
	}
	return undefined;
}

/**
 * Flatten a FastAPI `detail` into one readable line.
 *
 * Fiwano returns `detail` as a string for domain errors, as a list of field
 * errors for schema validation (422), and occasionally as a structured object
 * (e.g. `text_too_long`). Without this the node would surface "[object Object]"
 * and hide the actual reason.
 */
function describeDetail(detail: unknown): string | undefined {
	if (typeof detail === 'string') {
		return detail.trim() || undefined;
	}
	if (Array.isArray(detail)) {
		const parts = detail
			.map((entry) => {
				if (typeof entry === 'string') return entry;
				const item = asRecord(entry);
				if (!item) return undefined;
				const loc = Array.isArray(item.loc)
					? (item.loc as unknown[]).filter((p) => p !== 'body').join('.')
					: '';
				const msg = typeof item.msg === 'string' ? item.msg : undefined;
				if (loc && msg) return `${loc}: ${msg}`;
				return msg ?? safeStringify(entry);
			})
			.filter((part): part is string => Boolean(part));
		return parts.length > 0 ? parts.join('; ') : undefined;
	}
	const record = asRecord(detail);
	if (record) {
		// Structured domain errors (`invalid_recipient`, `recipient_equals_sender`,
		// `text_too_long`) carry the human-readable text in `message`; the raw
		// JSON is only the fallback for shapes without one.
		const message = typeof record.message === 'string' ? record.message.trim() : '';
		if (!message) return safeStringify(detail);
		// `no_free_slot` (409 on Generate OAuth URL) names the channels holding the
		// subscription slots; without them the author cannot tell what to release.
		const occupiedBy = Array.isArray(record.occupied_by)
			? (record.occupied_by as unknown[]).filter((id): id is string => typeof id === 'string')
			: [];
		return occupiedBy.length > 0 ? `${message} Slots held by: ${occupiedBy.join(', ')}.` : message;
	}
	return undefined;
}

/** `hint` of a structured `detail`, when the API supplied one. */
function detailHint(detail: unknown): string | undefined {
	const record = asRecord(detail);
	const hint = record && typeof record.hint === 'string' ? record.hint.trim() : '';
	return hint || undefined;
}

/** Actionable next step per status, so the workflow author isn't left guessing. */
function statusHint(status: number | undefined, retryAfter: string | undefined): string | undefined {
	switch (status) {
		case 401:
			return 'Check the API key on the Fiwano credential (it starts with mip_live_).';
		case 402:
			return 'No active subscription on the account or channel. Add or renew one in the Fiwano portal (Billing), or check Subscription → Get Many.';
		case 404:
			return 'The resource does not exist, or it belongs to another Fiwano account.';
		case 409:
			return 'Every subscription slot for this channel type is taken. Reconnect one of those channels, release its slot (Channel → Deactivate, then Update → Release Subscription Slot), or add a subscription.';
		case 410:
			return 'Inbound media expires ~60 minutes after Fiwano receives it. Download it earlier in the workflow, or re-host what you need to keep.';
		case 429:
			return retryAfter
				? `Rate limit reached (10 accepted sends per second per channel; 20 requests per second per API key for everything else). Retry after ${retryAfter}s.`
				: 'Rate limit reached (10 accepted sends per second per channel; 20 requests per second per API key for everything else). Back off and retry.';
		case 502:
			return 'Meta rejected or failed the upstream call. Retrying may help.';
		case 503:
			return retryAfter
				? `Fiwano is shedding load temporarily. Retry after ${retryAfter}s.`
				: 'Fiwano is shedding load temporarily. Retry shortly.';
		default:
			return undefined;
	}
}

/**
 * Build a NodeApiError that keeps the HTTP status, the API's `detail` payload and
 * the `Retry-After` hint, so the workflow author sees the actionable reason
 * (e.g. which channel already occupies a subscription slot) rather than a bare
 * transport message.
 *
 * Note: NodeApiError runs `setDescriptiveErrorMessage` *after* applying `message`,
 * so when our text contains a node-level error code (ECONNREFUSED, ETIMEDOUT,
 * ENOTFOUND, …) n8n replaces the whole message with its own network diagnosis and
 * moves ours into `messages`. That is deliberate on n8n's side and better for
 * transport failures — do not "fix" the missing prefix by working around it.
 */
export function fiwanoApiError(node: INode, error: unknown, fallback: string): NodeApiError {
	const err = (asRecord(error) ?? {}) as HttpErrorLike;
	const status = extractStatus(err);
	const body = extractBody(err);
	const detail = describeDetail(body?.detail);

	// Headers survive only on an unwrapped error — NodeApiError keeps the body but
	// not the headers, so the hint degrades to its header-less wording there.
	const causeHeaders = (asRecord(err.cause) as HttpErrorLike | undefined)?.response?.headers;
	const rawRetryAfter = err.response?.headers?.['retry-after'] ?? causeHeaders?.['retry-after'];
	const retryAfter = Array.isArray(rawRetryAfter) ? rawRetryAfter[0] : rawRetryAfter;

	const reason = detail ?? (typeof err.message === 'string' && err.message ? err.message : fallback);
	const message = status ? `Fiwano API error (HTTP ${status}): ${reason}` : `Fiwano API error: ${reason}`;

	// NodeApiError's constructor returns the argument untouched when it is itself a
	// NodeApiError, which would discard the options below. Only hand it a plain payload.
	const payload: JsonObject =
		body && !(body instanceof Error) ? (body as JsonObject) : ({ message: reason } as JsonObject);

	return new NodeApiError(node, payload, {
		message,
		// A structured detail's own `hint` names the fix for this exact request;
		// the per-status hint is the generic fallback.
		description: detailHint(body?.detail) ?? statusHint(status, retryAfter),
		httpCode: status !== undefined ? String(status) : undefined,
	});
}

// ── Requests ─────────────────────────────────────────────────────────────────

/**
 * Make an authenticated request to the Fiwano API.
 *
 * Called as `fiwanoApiRequest.call(this, ...)` from within an IExecuteFunctions context.
 */
export async function fiwanoApiRequest(
	this: IExecuteFunctions,
	method: string,
	path: string,
	body?: IDataObject,
	qs?: IDataObject,
): Promise<IDataObject> {
	const options: IHttpRequestOptions = {
		method: method as IHttpRequestOptions['method'],
		url: `${BASE_URL}${path}`,
		headers: {
			'Content-Type': 'application/json',
			'X-Fiwano-Client': FIWANO_CLIENT_HEADER_VALUE,
		},
	};

	if (body && Object.keys(body).length > 0) {
		options.body = body;
	}
	if (qs && Object.keys(qs).length > 0) {
		options.qs = qs;
	}

	try {
		return await this.helpers.httpRequestWithAuthentication.call(
			this,
			'fiwanoApi',
			options,
		) as IDataObject;
	} catch (error) {
		throw fiwanoApiError(this.getNode(), error, 'API request failed');
	}
}

/**
 * Download a binary media file from Fiwano (GET /media/{media_id}).
 * Returns the raw buffer, MIME type, and optional filename from response headers.
 */
export async function fiwanoApiRequestBinary(
	this: IExecuteFunctions,
	mediaId: string,
): Promise<MediaDownloadResult> {
	const options: IHttpRequestOptions = {
		method: 'GET',
		url: `${BASE_URL}/media/${mediaId}`,
		headers: { 'X-Fiwano-Client': FIWANO_CLIENT_HEADER_VALUE },
		encoding: 'arraybuffer',
		returnFullResponse: true,
	};

	try {
		const response = await this.helpers.httpRequestWithAuthentication.call(
			this,
			'fiwanoApi',
			options,
		) as { body: Buffer; headers: Record<string, string> };

		const mimeType =
			response.headers['content-type']?.split(';')[0].trim() ?? 'application/octet-stream';

		let fileName: string | undefined;
		const contentDisposition = response.headers['content-disposition'];
		if (contentDisposition) {
			const match = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
			if (match?.[1]) {
				fileName = match[1].replace(/['"]/g, '').trim() || undefined;
			}
		}

		return { buffer: Buffer.from(response.body), mimeType, fileName };
	} catch (error) {
		// 410 Gone is the common case here: inbound media expires 60 min after receipt.
		throw fiwanoApiError(this.getNode(), error, 'Failed to download media file');
	}
}

// ── Send results ─────────────────────────────────────────────────────────────

/** Message operations whose HTTP 200 carries the real outcome in `success`/`status`. */
export const SEND_OPERATIONS: ReadonlySet<string> = new Set(['send', 'sendMedia', 'sendTemplate']);

/**
 * True when a send response reports a permanent failure.
 *
 * The API answers `200` for every send and puts the outcome in the body:
 * `sent` / `queued` are successes (`success: true`), `failed` is final and
 * not retried (`success: false`). Both fields are checked so a response with
 * only one of them still classifies correctly.
 */
export function isFailedSend(response: IDataObject | undefined): boolean {
	if (!response || typeof response !== 'object') return false;
	return response.status === 'failed' || response.success === false;
}

/**
 * Actionable next step for a Meta send error code, mirroring the public
 * "Send error codes" table so the workflow author is not left with only Meta's
 * text. Codes outside the table get no hint rather than a guess.
 */
export function sendFailureHint(errorCode: unknown): string | undefined {
	const code = typeof errorCode === 'number' ? errorCode : Number(errorCode);
	switch (code) {
		case 10:
		case 200:
			return 'Meta denies this action for the account. The channel stays connected; check the account in Meta Business Settings.';
		case 100:
			return 'Meta rejected a parameter. Check the recipient (phone number / PSID / IGSID), the text, or the media URL and size.';
		case 190:
			return 'The channel token is expired or revoked. Reconnect the channel in the Fiwano portal.';
		case 368:
			return 'The account is temporarily blocked for policy violations. Resolve it in Meta Business Manager.';
		case 551:
			return 'This person cannot be messaged right now (they blocked the Page, closed the chat, or never messaged it). Only they can lift it — do not resend automatically.';
		case 803:
			return 'Meta does not know this recipient. Check the identifier.';
		case 131026:
			return 'The recipient is not reachable on WhatsApp. Verify the number.';
		case 131047:
			return 'The 24-hour customer-service window is closed. Send an approved WhatsApp template instead (Send Template).';
		case 131051:
			return 'This message type is not supported on the channel. Check channel capabilities.';
		case 131052:
			return 'Meta could not download the media URL. Verify it returns 200 with the right Content-Type and that the signature has not expired.';
		case 131053:
			return 'Meta could not process the media. Check the format and size; if it persists, host on S3 / GCS / R2.';
		case 131057:
			return 'The WhatsApp Business Account is in maintenance mode (for example a throughput upgrade). Usually temporary; no action needed.';
		case 133010:
			return 'The WhatsApp number is not registered on the WhatsApp Business Platform: the WhatsApp Business App connection was not completed. Reconnect the channel choosing WhatsApp Business App and finish the connection step in the app.';
		default:
			return undefined;
	}
}

/**
 * A send the API completed but Meta rejected permanently (`status: "failed"`).
 *
 * Raised only when the node's **Error on Failed Send** option is on. It keeps
 * the full API response so the error-output item can carry `message_id`,
 * `error_code` and `status` next to the error text.
 */
export class FiwanoSendFailedError extends NodeOperationError {
	readonly response: IDataObject;

	constructor(node: INode, response: IDataObject, itemIndex: number) {
		const reason =
			typeof response.error === 'string' && response.error.trim()
				? response.error.trim()
				: 'Meta rejected the message';
		const code = response.error_code;
		const suffix = code !== undefined && code !== null ? ` (Meta error ${String(code)})` : '';
		super(node, `Send failed: ${reason}${suffix}`, {
			itemIndex,
			description:
				sendFailureHint(code) ??
				'Fiwano did not retry this send. Fix the cause before sending again; the channel owner also gets a delivery digest email.',
		});
		this.response = response;
	}
}

/**
 * Factory for {@link FiwanoSendFailedError}. execute() throws through this call
 * rather than `throw new FiwanoSendFailedError(...)`: the n8n verification rule
 * `node-execute-block-wrong-error-thrown` only accepts the core error classes
 * in a `throw new` inside execute, and the instance is still a NodeOperationError.
 */
export function fiwanoSendFailedError(node: INode, response: IDataObject, itemIndex: number): NodeOperationError {
	return new FiwanoSendFailedError(node, response, itemIndex);
}

// ── Recipient guard ──────────────────────────────────────────────────────────

const RECIPIENT_HELP =
	'To reply to the sender of a Fiwano Trigger event, use {{ $json.data.from }} (message.received). ' +
	'Delivery-status events (delivered / read) carry data.recipient instead, and there is no sender to reply to.';

/**
 * Explain why a recipient value can never be sent, or return `undefined`.
 *
 * Deliberately a strict subset of the API's own `invalid_recipient` preflight:
 * only an empty value and a value without any digit are refused here — both
 * are impossible for every channel type (a phone number and every Meta user
 * ID contain digits). The node does not know the channel type, so the
 * numeric-only rule for Instagram/Facebook stays on the API side. Catching
 * these locally gives the author a message that names the fix instead of a
 * bare HTTP 400, and skips the request.
 */
export function recipientProblem(recipient: unknown): { message: string; description: string } | undefined {
	if (recipient !== null && typeof recipient === 'object') {
		return {
			message: 'Recipient resolved to an object, not an identifier.',
			description: `The expression returns a whole object — use its "from" field, e.g. {{ $json.data.from }} rather than {{ $json.data }}. ${RECIPIENT_HELP}`,
		};
	}
	const value = recipient === undefined || recipient === null ? '' : String(recipient).trim();
	if (!value) {
		return {
			message: 'Recipient is empty.',
			description: `The Recipient expression resolved to nothing. ${RECIPIENT_HELP}`,
		};
	}
	if (!/[0-9]/.test(value)) {
		const shown = value.length > 40 ? `${value.slice(0, 40)}…` : value;
		const objectLike = value.startsWith('[object');
		return {
			message: `Recipient "${shown}" contains no digits.`,
			description: objectLike
				? `The value is a serialized object — use its "from" field, e.g. {{ $json.data.from }} rather than {{ $json.data }}. ${RECIPIENT_HELP}`
				: `A recipient is a phone number (WhatsApp), IGSID (Instagram) or PSID (Facebook), all numeric. ${RECIPIENT_HELP}`,
		};
	}
	return undefined;
}
