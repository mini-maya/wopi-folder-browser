'use strict';

const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');

const BCRYPT_ROUNDS = 12;
const GENERATED_PASSWORD_LENGTH = 20;
const GENERATED_PASSWORD_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

async function hashPassword(password) {
	return bcrypt.hash(String(password), BCRYPT_ROUNDS);
}

async function verifyPassword(password, passwordHash) {
	return bcrypt.compare(String(password), String(passwordHash));
}

function generatePassword(length = GENERATED_PASSWORD_LENGTH) {
	if (!Number.isInteger(length) || length < 12) {
		throw new Error('Password length must be an integer of at least 12.');
	}

	const random = crypto.randomBytes(length);
	let value = '';
	for (let index = 0; index < random.length; index += 1) {
		value += GENERATED_PASSWORD_ALPHABET[random[index] % GENERATED_PASSWORD_ALPHABET.length];
	}
	return value;
}

module.exports = {
	generatePassword: generatePassword,
	hashPassword: hashPassword,
	verifyPassword: verifyPassword
};
