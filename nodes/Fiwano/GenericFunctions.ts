import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	INode,
	JsonObject,
	NodeApiError,
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
	if (asRecord(detail)) {
		return safeStringify(detail);
	}
	return undefined;
}

/** Actionable next step per status, so the workflow author isn't left guessing. */
function statusHint(status: number | undefined, retryAfter: string | undefined): string | undefined {
	switch (status) {
		case 401:
			return 'Check the API key on the Fiwano credential (it starts with mip_live_).';
		case 402:
			return 'The channel has no active subscription. Attach one in the Fiwano portal, or check Subscription → Get Many.';
		case 404:
			return 'The resource does not exist, or it belongs to another Fiwano account.';
		case 410:
			return 'Inbound media expires ~60 minutes after Fiwano receives it. Download it earlier in the workflow, or re-host what you need to keep.';
		case 429:
			return retryAfter
				? `Send rate limit reached (10 accepted sends per second per channel). Retry after ${retryAfter}s.`
				: 'Send rate limit reached (10 accepted sends per second per channel). Back off and retry.';
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
		description: statusHint(status, retryAfter),
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
