'use strict';

const path = require('node:path');

const { getCommonStateRoot, ensureDirectory, readJson, writeJsonAtomic } = require('../statePaths');

const DEFAULT_DOCUMENTS_STORAGE_ID = 'documents';
const DEFAULT_SHARED_STORAGE_ID = 'shared';
const DEFAULT_EXTERNAL_STORAGE_ID = 'external';

function parseBooleanFlag(value, defaultValue) {
	if (value === undefined || value === null || value === '') {
		return defaultValue;
	}
	const normalized = String(value).trim().toLowerCase();
	return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function createDocumentsStorageDefinition(config) {
	return {
		id: DEFAULT_DOCUMENTS_STORAGE_ID,
		name: 'Documents',
		type: 'local',
		root: config.documentRoot,
		scope: 'user',
		enabled: true,
		readOnly: false,
		system: true
	};
}

function createSharedStorageDefinition(config) {
	const mode = String(config.sharedStorageMode || 'disabled').trim().toLowerCase();
	const enabled = mode !== 'disabled';
	return {
		id: DEFAULT_SHARED_STORAGE_ID,
		name: 'Shared',
		type: 'local',
		root: config.sharedStorageRoot,
		scope: 'public',
		mode: mode,
		enabled: enabled,
		readOnly: mode === 'readonly',
		system: false
	};
}

function createExternalStorageDefinition(config) {
	const enabled = parseBooleanFlag(process.env.EXTERNAL_STORAGE_ENABLED, true);
	return {
		id: DEFAULT_EXTERNAL_STORAGE_ID,
		name: String(process.env.EXTERNAL_STORAGE_NAME || 'External Storage'),
		type: 'local',
		root: path.resolve(process.env.EXTERNAL_STORAGE_ROOT || '/external/storage'),
		scope: 'restricted',
		enabled: enabled,
		readOnly: parseBooleanFlag(process.env.EXTERNAL_STORAGE_READ_ONLY, false),
		allowedUserIds: [],
		system: false
	};
}

function getStoragesFilePath(config) {
	return path.join(getCommonStateRoot(config.documentRoot), 'storages.json');
}

function normalizeStorage(storage) {
	return {
		id: String(storage.id || '').trim(),
		name: String(storage.name || '').trim() || String(storage.id || '').trim(),
		type: String(storage.type || 'local').trim().toLowerCase(),
		root: path.resolve(String(storage.root || '')),
		scope: String(storage.scope || 'user').trim() || 'user',
		enabled: storage.enabled !== false,
		readOnly: storage.readOnly === true,
		system: storage.system === true,
		allowedUserIds: Array.isArray(storage.allowedUserIds) ? storage.allowedUserIds.map((userId) => String(userId)) : [],
		mode: storage.mode || undefined
	};
}

function mergeEnvOverrides(existing, envStorage) {
	if (existing.id !== DEFAULT_EXTERNAL_STORAGE_ID) {
		return existing;
	}
	const hasExternalNameOverride = process.env.EXTERNAL_STORAGE_NAME !== undefined && process.env.EXTERNAL_STORAGE_NAME !== '';
	const hasExternalEnabledOverride = process.env.EXTERNAL_STORAGE_ENABLED !== undefined && process.env.EXTERNAL_STORAGE_ENABLED !== '';
	const hasExternalReadOnlyOverride = process.env.EXTERNAL_STORAGE_READ_ONLY !== undefined && process.env.EXTERNAL_STORAGE_READ_ONLY !== '';
	const hasExternalRootOverride = process.env.EXTERNAL_STORAGE_ROOT !== undefined && process.env.EXTERNAL_STORAGE_ROOT !== '';
	return {
		...existing,
		name: hasExternalNameOverride ? envStorage.name : existing.name,
		root: hasExternalRootOverride ? envStorage.root : existing.root,
		enabled: hasExternalEnabledOverride ? envStorage.enabled : existing.enabled,
		readOnly: hasExternalReadOnlyOverride ? envStorage.readOnly : existing.readOnly
	};
}

async function ensureStorageRegistry(config) {
	const storagesPath = getStoragesFilePath(config);
	await ensureDirectory(path.dirname(storagesPath));
	const defaults = [
		createDocumentsStorageDefinition(config),
		createSharedStorageDefinition(config),
		createExternalStorageDefinition(config)
	];
	const payload = await readJson(storagesPath, { storages: defaults });
	const loaded = Array.isArray(payload?.storages) ? payload.storages.map(normalizeStorage) : [];

	const byId = new Map();
	for (const storage of loaded) {
		if (!storage.id) {
			continue;
		}
		byId.set(storage.id, storage);
	}

	const documentsStorage = createDocumentsStorageDefinition(config);
	byId.set(DEFAULT_DOCUMENTS_STORAGE_ID, {
		...(byId.get(DEFAULT_DOCUMENTS_STORAGE_ID) || {}),
		...documentsStorage,
		enabled: true,
		scope: 'user',
		system: true
	});

	const sharedStorage = createSharedStorageDefinition(config);
	const existingShared = byId.get(DEFAULT_SHARED_STORAGE_ID) || {};
	byId.set(DEFAULT_SHARED_STORAGE_ID, {
		...existingShared,
		...sharedStorage,
		name: String(existingShared.name || '').trim() || sharedStorage.name,
		scope: 'public',
		mode: sharedStorage.mode,
		enabled: sharedStorage.enabled,
		readOnly: sharedStorage.readOnly,
		system: false
	});

	const externalFromEnv = createExternalStorageDefinition(config);
	const existingExternal = byId.get(DEFAULT_EXTERNAL_STORAGE_ID);
	if (existingExternal) {
		byId.set(DEFAULT_EXTERNAL_STORAGE_ID, mergeEnvOverrides(existingExternal, externalFromEnv));
	} else if (externalFromEnv.enabled) {
		byId.set(DEFAULT_EXTERNAL_STORAGE_ID, externalFromEnv);
	}

	const storages = [...byId.values()];
	await writeJsonAtomic(storagesPath, { storages });
	return storages;
}

module.exports = {
	DEFAULT_DOCUMENTS_STORAGE_ID,
	DEFAULT_SHARED_STORAGE_ID,
	DEFAULT_EXTERNAL_STORAGE_ID,
	createDocumentsStorageDefinition,
	createSharedStorageDefinition,
	createExternalStorageDefinition,
	ensureStorageRegistry
};
