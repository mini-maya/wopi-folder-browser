'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { createHttpError } = require('../../errors');
const { StorageReadOnlyError } = require('../errors');
const { resolveSafePath } = require('../storagePath');

class LocalStorageProvider {
	constructor(root, options = {}) {
		this.root = root;
		this.readOnly = options.readOnly === true;
	}

	async list(relativePath = '') {
		const resolved = await resolveSafePath(this.root, relativePath);
		return fs.readdir(resolved.absolutePath, { withFileTypes: true });
	}

	async stat(relativePath) {
		const resolved = await resolveSafePath(this.root, relativePath);
		return fs.stat(resolved.absolutePath);
	}

	async exists(relativePath) {
		try {
			await this.stat(relativePath);
			return true;
		} catch (error) {
			if (error.code === 'ENOENT') {
				return false;
			}
			throw error;
		}
	}

	async read(relativePath, encoding = null) {
		const resolved = await resolveSafePath(this.root, relativePath);
		return fs.readFile(resolved.absolutePath, encoding ? { encoding } : undefined);
	}

	async write(relativePath, data) {
		this.assertWritable();
		const resolved = await resolveSafePath(this.root, relativePath);
		await fs.mkdir(path.dirname(resolved.absolutePath), { recursive: true });
		await fs.writeFile(resolved.absolutePath, data);
	}

	async delete(relativePath) {
		this.assertWritable();
		const resolved = await resolveSafePath(this.root, relativePath);
		const stat = await fs.stat(resolved.absolutePath);
		if (stat.isDirectory()) {
			await fs.rm(resolved.absolutePath, { recursive: true, force: false });
			return;
		}
		await fs.unlink(resolved.absolutePath);
	}

	async rename(sourcePath, destinationPath) {
		this.assertWritable();
		const source = await resolveSafePath(this.root, sourcePath);
		const destination = await resolveSafePath(this.root, destinationPath);
		await fs.mkdir(path.dirname(destination.absolutePath), { recursive: true });
		await fs.rename(source.absolutePath, destination.absolutePath);
	}

	async copy(sourcePath, destinationPath) {
		this.assertWritable();
		const source = await resolveSafePath(this.root, sourcePath);
		const destination = await resolveSafePath(this.root, destinationPath);
		await fs.mkdir(path.dirname(destination.absolutePath), { recursive: true });
		await fs.copyFile(source.absolutePath, destination.absolutePath);
	}

	async mkdir(relativePath) {
		this.assertWritable();
		const resolved = await resolveSafePath(this.root, relativePath);
		await fs.mkdir(resolved.absolutePath, { recursive: true });
	}

	async healthCheck() {
		try {
			const resolvedRoot = await resolveSafePath(this.root, '');
			const stats = await fs.stat(resolvedRoot.absolutePath);
			if (!stats.isDirectory()) {
				return { available: false, readable: false, writable: false, reason: 'Path is not a directory.' };
			}
			const readable = true;
			if (this.readOnly) {
				return { available: true, readable, writable: false };
			}
			const probeName = `.wopi-write-probe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
			const probePath = path.join(resolvedRoot.absolutePath, probeName);
			await fs.writeFile(probePath, '');
			await fs.unlink(probePath);
			return { available: true, readable, writable: true };
		} catch (error) {
			return {
				available: false,
				readable: false,
				writable: false,
				reason: error.message
			};
		}
	}

	assertWritable() {
		if (!this.readOnly) {
			return;
		}
		const error = createHttpError(403, 'This storage is read-only.');
		error.code = 'STORAGE_READ_ONLY';
		throw error;
	}
}

module.exports = {
	LocalStorageProvider,
	StorageReadOnlyError
};
