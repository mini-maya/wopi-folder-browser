export function getFileTypeKey(document) {
	if (document.isDirectory) {
		return 'folder';
	}
	const mimeType = document.mimeType || '';
	if (mimeType.includes('spreadsheet') || mimeType.includes('spreadsheetml') || mimeType.includes('ms-excel')) {
		return 'spreadsheet';
	}
	if (mimeType.includes('presentation') || mimeType.includes('presentationml') || mimeType.includes('ms-powerpoint')) {
		return 'presentation';
	}
	if (mimeType.includes('text') || mimeType.includes('csv') || mimeType.includes('wordprocessingml') || mimeType.includes('msword')) {
		return 'text';
	}
	return 'default';
}

export function folderContainsFiles(folderDocument, documents) {
	if (!folderDocument || !folderDocument.isDirectory) {
		return false;
	}
	const prefix = `${folderDocument.relativePath}/`;
	for (const document of documents) {
		if (!document.isDirectory && document.relativePath.startsWith(prefix)) {
			return true;
		}
	}
	return false;
}

export function buildFolderPictogramSvg(options) {
	const { isOpen, hasFiles, isFavorite, preferFavoriteIcon } = options;
	const openFolderWithoutFilesSvg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" xml:space="preserve">
			<g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
				<path d="M 73.538 35.162 l -52.548 1.952 c -1.739 0 -2.753 0.651 -3.232 2.323 L 6.85 76.754 c -0.451 1.586 -2.613 2.328 -4.117 2.328 h 0 C 1.23 79.082 0 77.852 0 76.349 l 0 -10.458 V 23.046 v -2.047 v -6.273 c 0 -2.103 1.705 -3.808 3.808 -3.808 h 27.056 c 1.01 0 1.978 0.401 2.692 1.115 l 7.85 7.85 c 0.714 0.714 1.683 1.115 2.692 1.115 H 69.73 c 2.103 0 3.808 1.705 3.808 3.808 v 1.301 C 73.538 26.106 73.538 35.162 73.538 35.162 z" fill="rgb(224,173,49)"/>
				<path d="M 2.733 79.082 L 2.733 79.082 c 1.503 0 2.282 -1.147 2.733 -2.733 l 10.996 -38.362 c 0.479 -1.672 2.008 -2.824 3.748 -2.824 h 67.379 c 1.609 0 2.765 1.546 2.311 3.09 L 79.004 75.279 c -0.492 1.751 -1.571 3.818 -3.803 3.803 C 75.201 79.082 2.733 79.082 2.733 79.082 z" fill="rgb(255,200,67)"/>
			</g>
		</svg>
	`;
	const openFolderWithFilesSvg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" xml:space="preserve">
			<g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
				<path d="M 73.538 35.162 l -52.548 1.952 c -1.739 0 -2.753 0.651 -3.232 2.323 L 6.85 76.754 c -0.451 1.586 -2.613 2.328 -4.117 2.328 h 0 C 1.23 79.082 0 77.852 0 76.349 l 0 -10.458 V 23.046 v -2.047 v -6.273 c 0 -2.103 1.705 -3.808 3.808 -3.808 h 27.056 c 1.01 0 1.978 0.401 2.692 1.115 l 7.85 7.85 c 0.714 0.714 1.683 1.115 2.692 1.115 H 69.73 c 2.103 0 3.808 1.705 3.808 3.808 v 1.301 L 73.538 35.162 z" fill="rgb(224,173,49)"/>
				<path d="M 63.726 14.605 v 54.54 c 0 1.386 -1.124 2.51 -2.51 2.51 H 13.02 c -1.386 0 -2.51 -1.124 -2.51 -2.51 V 2.51 c 0 -1.386 1.124 -2.51 2.51 -2.51 H 49.12 C 51.554 6.059 56.533 10.874 63.726 14.605 z" fill="rgb(233,233,224)"/>
				<path d="M 63.726 14.605 H 51.407 c -1.263 0 -2.287 -1.024 -2.287 -2.287 V 0 L 63.726 14.605 z" fill="rgb(217,215,202)"/>
				<path d="M 52.978 23.363 H 20.139 c -0.829 0 -1.5 -0.671 -1.5 -1.5 s 0.671 -1.5 1.5 -1.5 h 32.839 c 0.828 0 1.5 0.671 1.5 1.5 S 53.806 23.363 52.978 23.363 z" fill="rgb(217,215,202)"/>
				<path d="M 52.978 30.363 H 20.139 c -0.829 0 -1.5 -0.671 -1.5 -1.5 s 0.671 -1.5 1.5 -1.5 h 32.839 c 0.828 0 1.5 0.671 1.5 1.5 S 53.806 30.363 52.978 30.363 z" fill="rgb(217,215,202)"/>
				<path d="M 2.733 79.082 L 2.733 79.082 c 1.503 0 2.282 -1.147 2.733 -2.733 l 10.996 -38.362 c 0.479 -1.672 2.008 -2.824 3.748 -2.824 h 67.379 c 1.609 0 2.765 1.546 2.311 3.09 L 79.004 75.279 c -0.492 1.751 -1.571 3.818 -3.803 3.803 H 2.733 z" fill="rgb(255,200,67)"/>
			</g>
		</svg>
	`;
	const closedFolderSvg = `
		<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256" xml:space="preserve">
			<g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
				<path d="M 0 68.798 v 11.914 c 0 1.713 1.401 3.114 3.114 3.114 h 0 c 3.344 0 4.805 -2.642 4.805 -2.642 L 8.14 29.281 l 2.739 -2.827 l 72.894 -2.977 v -1.482 c 0 -2.396 -1.942 -4.338 -4.338 -4.338 H 50.236 c -1.15 0 -2.254 -0.457 -3.067 -1.27 l -8.943 -8.943 c -0.813 -0.813 -1.917 -1.27 -3.067 -1.27 H 4.338 C 1.942 6.174 0 8.116 0 10.512 v 7.146 v 2.332 V 68.798" fill="rgb(224,173,49)"/>
				<path d="M 3.114 83.826 L 3.114 83.826 c 1.713 0 3.114 -1.401 3.114 -3.114 V 27.81 c 0 -2.393 1.94 -4.333 4.333 -4.333 h 75.107 c 2.393 0 4.333 1.94 4.333 4.333 v 51.684 c 0 2.393 -1.94 4.333 -4.333 4.333 C 85.667 83.826 3.114 83.826 3.114 83.826 z" fill="rgb(255,200,67)"/>
			</g>
		</svg>
	`;
	const favoriteFolderSvg = `
		<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="256" height="256" viewBox="0 0 256 256" xml:space="preserve">
			<g transform="translate(1.4065934065934016 1.4065934065934016) scale(2.81 2.81)">
				<path d="M 0 68.798 v 11.914 c 0 1.713 1.401 3.114 3.114 3.114 h 0 c 3.344 0 4.805 -2.642 4.805 -2.642 L 8.14 29.281 l 2.739 -2.827 l 72.894 -2.977 v -1.482 c 0 -2.396 -1.942 -4.338 -4.338 -4.338 H 50.236 c -1.15 0 -2.254 -0.457 -3.067 -1.27 l -8.943 -8.943 c -0.813 -0.813 -1.917 -1.27 -3.067 -1.27 H 4.338 C 1.942 6.174 0 8.116 0 10.512 v 7.146 v 2.332 V 68.798" fill="rgb(224,173,49)"/>
				<path d="M 3.114 83.826 L 3.114 83.826 c 1.713 0 3.114 -1.401 3.114 -3.114 V 27.81 c 0 -2.393 1.94 -4.333 4.333 -4.333 h 75.107 c 2.393 0 4.333 1.94 4.333 4.333 v 51.684 c 0 2.393 -1.94 4.333 -4.333 4.333 C 85.667 83.826 3.114 83.826 3.114 83.826 z" fill="rgb(255,200,67)"/>
				<path d="M 35.679 72.029 c -0.311 0 -0.62 -0.097 -0.882 -0.286 c -0.462 -0.336 -0.693 -0.904 -0.597 -1.468 l 1.997 -11.645 l -8.46 -8.246 c -0.409 -0.398 -0.556 -0.995 -0.38 -1.538 c 0.177 -0.543 0.646 -0.938 1.211 -1.021 l 11.692 -1.699 l 5.229 -10.595 c 0.253 -0.512 0.774 -0.836 1.345 -0.836 l 0 0 c 0.571 0 1.093 0.324 1.345 0.836 l 5.229 10.594 l 11.692 1.699 c 0.564 0.082 1.034 0.478 1.211 1.021 c 0.176 0.543 0.029 1.14 -0.38 1.538 l -8.461 8.246 l 1.998 11.645 c 0.097 0.563 -0.135 1.132 -0.597 1.468 c -0.464 0.336 -1.074 0.38 -1.58 0.114 l -10.457 -5.498 l -10.458 5.498 C 36.158 71.973 35.918 72.029 35.679 72.029 z M 32.008 50.357 l 6.848 6.676 c 0.354 0.345 0.515 0.841 0.432 1.328 l -1.617 9.426 l 8.465 -4.45 c 0.438 -0.229 0.96 -0.229 1.396 0 l 8.465 4.45 l -1.617 -9.426 c -0.083 -0.487 0.078 -0.983 0.432 -1.328 l 6.849 -6.676 l -9.465 -1.375 c -0.488 -0.071 -0.911 -0.378 -1.129 -0.82 l -4.232 -8.577 l -4.233 8.577 c -0.219 0.442 -0.641 0.749 -1.129 0.82 L 32.008 50.357 z" fill="rgb(184,53,53)"/>
			</g>
		</svg>
	`;
	const useFavoriteIcon = Boolean(isFavorite && (preferFavoriteIcon || !isOpen));
	const effectiveHasFiles = isOpen && hasFiles;
	let svg = closedFolderSvg;
	if (useFavoriteIcon) {
		svg = favoriteFolderSvg;
	} else if (isOpen) {
		svg = effectiveHasFiles ? openFolderWithFilesSvg : openFolderWithoutFilesSvg;
	}
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildFilePreviewSvg(document) {
	const MIME_SVG_MAP = {
		spreadsheet: `
			<svg fill="#007C3C" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<title>LibreOffice Calc</title>
			<path d="M9 13H7v-1h2v1zm6-3h-2v1h2v-1zm-6 0H7v1h2v-1zm3 0h-2v1h2v-1zm3-10 7 7V0h-7zM9 14H7v1h2v-1zm5 3h1v-3h-1v3zm2 0h1v-1h-1v1zm-4 0h1v-2h-1v2zm1-17 9 9v12c0 1.662-1.338 3-3 3H5c-1.662 0-3-1.338-3-3V3c0-1.662 1.338-3 3-3h8zm5 13h-7v5h7v-5zm-2-4H6v7h4.5v-1H10v-1h.5v-1H10v-1h2v.5h1V12h2v.5h1V9z"/>
			</svg>
		`,
		text: `
			<svg fill="#083FA6" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<title>LibreOffice Writer</title>
            <path d="M22 0v7l-7-7h7zm0 9v12c0 1.662-1.338 3-3 3H5c-1.662 0-3-1.338-3-3V3c0-1.662 1.338-3 3-3h8l9 9zM6 10h5V9H6v1zm0 2h5v-1H6v1zm0 2h5v-1H6v1zm5 3H6v1h5v-1zm7-2H6v1h12v-1zm0-6h-6v5h6V9zm-1.5 2a.5.5 0 1 0 0-1 .5.5 0 0 0 0 1zM14 11l-1 2h3l-2-2z"/>
            </svg>
		`,
		presentation: `
			<svg fill="#D0120D" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<title>LibreOffice Impress</title><path d="M22 0v7l-7-7h7zm-9 0 9 9v12c0 1.662-1.338 3-3 3H5c-1.662 0-3-1.338-3-3V3c0-1.662 1.338-3 3-3h8zM7 17H6v1h1v-1zm0-2H6v1h1v-1zm0-2H6v1h1v-1zm3 4H8v1h2v-1zm0-2H8v1h2v-1zm0-2H8v1h2v-1zm6-1v-1H8v1h8zm2 1h-7v5h7v-5zm0-4H6v1h12V9zm-4 6.707 1 1 2.207-2.207-.707-.707-1.5 1.5-1-1-2.207 2.207.707.707 1.5-1.5z"/>
			</svg>
		`,
		default: `
			<svg fill="#7324A9" role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
			<title>LibreOffice Base</title><path d="M17 13h-1v-1h1v1zm0 1h-1v1h1v-1zm0 2h-1v1h1v-1zm-.6-16H15l7 7V0h-5.6zM13 0l9 9v12c0 1.662-1.338 3-3 3H5c-1.662 0-3-1.338-3-3V3c0-1.662 1.338-3 3-3h8zM6 11c0 .552 1.343 1 3 1s3-.448 3-1v-1c0-.552-1.343-1-3-1s-3 .448-3 1v1zm0 2c0 .552 1.343 1 3 1s3-.448 3-1v-1c0 .552-1.343 1-3 1s-3-.448-3-1v1zm0 2c0 .552 1.343 1 3 1s3-.448 3-1v-1c0 .552-1.343 1-3 1s-3-.448-3-1v1zm0 2c0 .552 1.343 1 3 1s3-.448 3-1v-1c0 .552-1.343 1-3 1s-3-.448-3-1v1zm12-6h-5v7h5v-7zm-3 1h-1v1h1v-1zm0 4h-1v1h1v-1zm0-2h-1v1h1v-1z"/>
			</svg>
		`
	};
	const typeKey = getFileTypeKey(document);
	const svg = MIME_SVG_MAP[typeKey];
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
