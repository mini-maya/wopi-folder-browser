import { getCurrentMountId } from '../state/currentMount.mjs';

export async function requestJson(url, options = {}) {
	const headers = new Headers(options.headers || {});
	const mountId = getCurrentMountId();
	if (mountId && !headers.has('X-Mount-Id')) {
		headers.set('X-Mount-Id', mountId);
	}
	const response = await fetch(url, {
		...options,
		headers
	});
	let payload;

	try {
		payload = await response.json();
	} catch (error) {
		payload = null;
	}

	if (!response.ok) {
		const message = payload?.error ?? `Request failed with status ${response.status}.`;
		const error = new Error(message);
		error.status = response.status;
		error.payload = payload;
		throw error;
	}

	return payload;
}
