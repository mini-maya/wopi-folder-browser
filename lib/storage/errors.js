'use strict';

class StorageError extends Error {
	constructor(message) {
		super(message);
		this.name = this.constructor.name;
	}
}

class StorageNotFoundError extends StorageError {}
class StorageUnavailableError extends StorageError {}
class StorageReadOnlyError extends StorageError {}
class StoragePathError extends StorageError {}

module.exports = {
	StorageError,
	StorageNotFoundError,
	StoragePathError,
	StorageReadOnlyError,
	StorageUnavailableError
};
