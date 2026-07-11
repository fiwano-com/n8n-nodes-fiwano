import {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	NodeApiError,
} from 'n8n-workflow';

export interface MediaDownloadResult {
	buffer: Buffer;
	mimeType: string;
	fileName: string | undefined;
}

const BASE_URL = 'https://fiwano.com/api/v1';
export const FIWANO_CLIENT_HEADER_VALUE = 'n8n-nodes-fiwano';

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
		const err = error as Error;
		throw new NodeApiError(this.getNode(), { message: err.message || 'API request failed' });
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
		const err = error as Error;
		throw new NodeApiError(this.getNode(), { message: err.message || 'Failed to download media file' });
	}
}
