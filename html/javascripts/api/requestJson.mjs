export async function requestJson(url, options = {}) {
	const response = await fetch(url, options);
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
