const DEFAULT_DURATION_MS = 4000;

export function createToastController({
	container,
	durationMs = DEFAULT_DURATION_MS
}) {
	function removeToast(toast) {
		toast.classList.remove('is-visible');
		toast.addEventListener('transitionend', function onTransitionEnd() {
			toast.removeEventListener('transitionend', onTransitionEnd);
			toast.remove();
		});
		// Fallback in case the transitionend event never fires (e.g. reduced motion).
		setTimeout(function() {
			toast.remove();
		}, 300);
	}

	function showToast(message, type = 'info') {
		if (!container || !message) {
			return;
		}
		const toast = document.createElement('div');
		toast.className = `toast toast-${type}`;
		toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
		toast.textContent = message;
		container.appendChild(toast);
		// Force layout so the subsequent class toggle triggers the CSS transition.
		void toast.offsetWidth;
		toast.classList.add('is-visible');
		setTimeout(function() {
			removeToast(toast);
		}, durationMs);
	}

	return {
		showToast: showToast
	};
}
