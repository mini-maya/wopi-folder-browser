export async function requestJson(url, options = {}) {
	const headers = new Headers(options.headers || {});
	const match = window.location.pathname.match(/^\/storage\/([^/]+)/);
	if (match?.[1] && !headers.has('X-Storage-Id')) {
		headers.set('X-Storage-Id', decodeURIComponent(match[1]));
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
