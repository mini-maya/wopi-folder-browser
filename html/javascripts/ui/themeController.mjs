const THEME_MODES = new Set(['auto', 'light', 'dark']);

function resolveTheme(mode, systemThemeMediaQuery) {
	if (mode === 'dark') {
		return 'dark';
	}
	if (mode === 'light') {
		return 'light';
	}

	return systemThemeMediaQuery.matches ? 'dark' : 'light';
}

function getStoredThemeMode(storageKey) {
	const storedMode = localStorage.getItem(storageKey);
	if (storedMode && THEME_MODES.has(storedMode)) {
		return storedMode;
	}

	return 'auto';
}

export function createThemeController({ appState, themeSelect, storageKey = 'wopi-folder-browser-theme', systemThemeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)') }) {
	function applyThemeMode(mode, persistPreference) {
		const normalizedMode = THEME_MODES.has(mode) ? mode : 'auto';
		const resolvedTheme = resolveTheme(normalizedMode, systemThemeMediaQuery);
		appState.themeMode = normalizedMode;
		document.body.dataset.theme = resolvedTheme;
		themeSelect.value = normalizedMode;
		if (persistPreference) {
			localStorage.setItem(storageKey, normalizedMode);
		}
	}

	function initializeTheme() {
		applyThemeMode(getStoredThemeMode(storageKey), false);
		systemThemeMediaQuery.addEventListener('change', function() {
			if (appState.themeMode === 'auto') {
				applyThemeMode('auto', false);
			}
		});
	}

	return {
		applyThemeMode,
		initializeTheme
	};
}
