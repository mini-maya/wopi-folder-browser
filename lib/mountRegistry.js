'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

/**
 * Mount Registry: Discovers and manages Docker-mounted directories
 * Mounts are discovered from the mountRoot directory at startup.
 * Each subdirectory in mountRoot becomes a Mount.
 * 
 * Example:
 *   /mnt/documents  → Mount { id: 'documents', name: 'documents', root: '/mnt/documents' }
 *   /mnt/projects   → Mount { id: 'projects', name: 'projects', root: '/mnt/projects' }
 *   /mnt/archive    → Mount { id: 'archive', name: 'archive', root: '/mnt/archive' }
 */

class MountRegistry {
	constructor(config) {
		this.config = config;
		this.mounts = [];
		this.mountsById = new Map();
	}

	/**
	 * Discover mounts by scanning the mount root directory
	 */
	async discover() {
		this.mounts = [];
		this.mountsById.clear();

		const mountRoot = this.config.mountRoot;

		try {
			await fs.access(mountRoot);
		} catch (error) {
			console.warn(`[mount] Mount root does not exist: ${mountRoot}`);
			return [];
		}

		try {
			const entries = await fs.readdir(mountRoot, { withFileTypes: true });

			for (const entry of entries) {
				if (entry.isDirectory() && !entry.name.startsWith('.')) {
					const mountId = entry.name;
					const mountPath = path.join(mountRoot, mountId);

					const available = await this._isAccessible(mountPath);
					const mount = {
						id: mountId,
						name: mountId,
						root: mountPath,
						available: available
					};

					this.mounts.push(mount);
					this.mountsById.set(mountId, mount);

					if (mount.available) {
						console.info(`[mount] Discovered: ${mount.id} (${mount.root})`);
					} else {
						console.warn(`[mount] Discovered but not accessible: ${mount.id} (${mount.root})`);
					}
				}
			}
		} catch (error) {
			console.error(`[mount] Error discovering mounts:`, error);
			throw error;
		}

		return this.mounts;
	}

	/**
	 * Get all mounts (readonly)
	 */
	getAll() {
		return [...this.mounts];
	}

	/**
	 * Get a specific mount by ID
	 */
	get(mountId) {
		const mount = this.mountsById.get(String(mountId || ''));
		return mount || null;
	}

	/**
	 * Get mounts available to a specific user (based on permissions)
	 * @param {string} userId - The user ID
	 * @param {Array} userMounts - Array of mount IDs the user has access to
	 */
	getUserMounts(userId, userMounts) {
		if (!Array.isArray(userMounts)) {
			return [];
		}

		return userMounts
			.map(mountId => this.get(String(mountId)))
			.filter(mount => mount !== null && mount.available);
	}

	/**
	 * Validate that a mount exists and is accessible
	 */
	validateMount(mountId) {
		const mount = this.get(mountId);
		if (!mount) {
			return { valid: false, reason: `Mount not found: ${mountId}` };
		}
		if (!mount.available) {
			return { valid: false, reason: `Mount not accessible: ${mountId}` };
		}
		return { valid: true, mount };
	}

	/**
	 * Check if a path is accessible (readable)
	 * @private
	 */
	async _isAccessible(mountPath) {
		try {
			await fs.access(mountPath);
			return true;
		} catch (error) {
			return false;
		}
	}
}

module.exports = MountRegistry;
