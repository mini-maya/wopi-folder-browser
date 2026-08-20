'use strict';

const { createHttpError } = require('../errors');
const { LocalStorageProvider } = require('./providers/localStorageProvider');
const { StorageNotFoundError, StorageUnavailableError } = require('./errors');
const { DEFAULT_DOCUMENTS_STORAGE_ID, ensureStorageRegistry } = require('./storageRegistry');

class StorageManager {
	constructor(config) {
		this.config = config;
		this.storages = [];
		this.providers = new Map();
		this.health = new Map();
		this.initialized = false;
	}

	async initialize() {
		this.storages = await ensureStorageRegistry(this.config);
		this.providers.clear();
		this.health.clear();
		for (const storage of this.storages) {
			if (!storage.enabled) {
				this.health.set(storage.id, {
					available: false,
					readable: false,
					writable: false,
					reason: 'Storage disabled.'
				});
				continue;
			}
			if (storage.type !== 'local') {
				this.health.set(storage.id, {
					available: false,
					readable: false,
					writable: false,
					reason: `Unsupported storage type: ${storage.type}`
				});
				continue;
			}
			const provider = new LocalStorageProvider(storage.root, { readOnly: storage.readOnly });
			this.providers.set(storage.id, provider);
			const health = await provider.healthCheck();
			this.health.set(storage.id, health);
			if (health.available) {
				console.info(`[storage] ${storage.id}: OK (${storage.root})`);
			} else {
				console.warn(`[storage] ${storage.id}: unavailable`);
				if (health.reason) {
					console.warn(`[storage] ${storage.id}: ${health.reason}`);
				}
			}
		}
		this.initialized = true;
	}

	async ensureInitialized() {
		if (this.initialized) {
			return;
		}
		await this.initialize();
	}

	list() {
		return this.storages.map((storage) => ({
			id: storage.id,
			name: storage.name,
			type: storage.type,
			enabled: storage.enabled !== false,
			readOnly: storage.readOnly === true,
			available: this.health.get(storage.id)?.available === true
		}));
	}

	get(storageId) {
		const normalizedId = String(storageId || DEFAULT_DOCUMENTS_STORAGE_ID);
		const storage = this.storages.find((entry) => entry.id === normalizedId && entry.enabled !== false);
		if (!storage) {
			throw new StorageNotFoundError(`Storage not found: ${normalizedId}`);
		}
		return storage;
	}

	getProviderForRoot(root, readOnly = false) {
		return new LocalStorageProvider(root, { readOnly });
	}

	getProvider(storageId) {
		const storage = this.get(storageId);
		const health = this.health.get(storage.id);
		if (!health?.available) {
			throw new StorageUnavailableError(`Storage unavailable: ${storage.id}`);
		}
		const provider = this.providers.get(storage.id);
		if (!provider) {
			throw new StorageUnavailableError(`Storage provider unavailable: ${storage.id}`);
		}
		return provider;
	}

	resolveOrHttpError(storageId) {
		try {
			const storage = this.get(storageId);
			const provider = this.getProvider(storage.id);
			return { storage, provider };
		} catch (error) {
			if (error instanceof StorageNotFoundError) {
				throw createHttpError(404, error.message);
			}
			if (error instanceof StorageUnavailableError) {
				throw createHttpError(503, error.message);
			}
			throw error;
		}
	}

	async persistStorages() {
		const { ensureDirectory, writeJsonAtomic, getCommonStateRoot } = require('../statePaths');
		const path = require('node:path');
		const storagesPath = path.join(getCommonStateRoot(this.config.documentRoot), 'storages.json');
		await ensureDirectory(path.dirname(storagesPath));
		await writeJsonAtomic(storagesPath, { storages: this.storages });
	}

	async updateExternalAcl(allowedUserIds) {
		const externalStorage = this.storages.find((s) => s.id === 'external');
		if (!externalStorage) {
			throw new Error('External storage not found');
		}
		externalStorage.allowedUserIds = Array.isArray(allowedUserIds)
			? allowedUserIds.map((id) => String(id).trim()).filter(Boolean)
			: [];
		await this.persistStorages();
	}
}

module.exports = {
	StorageManager
};
