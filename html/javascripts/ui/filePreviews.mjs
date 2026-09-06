import { getFilePictogram } from '../icons/filePictograms.mjs';

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
	const useFavoriteIcon = Boolean(isFavorite && (preferFavoriteIcon || !isOpen));
	const effectiveHasFiles = isOpen && hasFiles;
	
	let pictogramKey = 'folder-closed';
	if (useFavoriteIcon) {
		pictogramKey = 'folder-favorite';
	} else if (isOpen) {
		pictogramKey = effectiveHasFiles ? 'folder-open-with-files' : 'folder-open-without-files';
	}
	
	const svg = getFilePictogram(pictogramKey);
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

export function buildFilePreviewSvg(document) {
	const MIME_PICTOGRAM_MAP = {
		spreadsheet: 'file-spreadsheet',
		text: 'file-text',
		presentation: 'file-presentation',
		default: 'file-default'
	};
	const typeKey = getFileTypeKey(document);
	const pictogramKey = MIME_PICTOGRAM_MAP[typeKey];
	const svg = getFilePictogram(pictogramKey);
	return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
