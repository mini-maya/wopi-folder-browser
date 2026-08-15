'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');

const { createHttpError } = require('./errors');
const { SUPPORTED_MIME_TYPES, createDocument } = require('./documentStore');

const TEMPLATE_SCOPES = ['personal', 'group', 'global', 'admin'];

function createTemplateId(scope, relativePath) {
	return Buffer.from(`${scope}:${relativePath}`, 'utf8').toString('base64url');
}

function parseTemplateId(templateId) {
	const decoded = Buffer.from(templateId, 'base64url').toString('utf8');
	const separatorIndex = decoded.indexOf(':');
	if (separatorIndex <= 0) {
		throw createHttpError(400, 'Invalid template id.');
	}

	return {
		scope: decoded.slice(0, separatorIndex),
		relativePath: decoded.slice(separatorIndex + 1)
	};
}

function getScopeDirectories(config, user) {
	const groupScopes = (user.groups || []).map((groupId) => ({
		scope: 'group',
		scopeLabel: `group:${groupId}`,
		directory: path.join(config.templateRoot, 'groups', groupId)
	}));

	return [
		{
			scope: 'personal',
			scopeLabel: 'personal',
			directory: path.join(config.templateRoot, 'personal', user.id)
		},
		...groupScopes,
		{
			scope: 'global',
			scopeLabel: 'global',
			directory: path.join(config.templateRoot, 'global')
		},
		{
			scope: 'admin',
			scopeLabel: 'admin',
			directory: path.join(config.templateRoot, 'admin')
		}
	];
}

async function listTemplates(config, user) {
	const directories = getScopeDirectories(config, user);
	const templates = [];
	for (const directory of directories) {
		let entries = [];
		try {
			entries = await fs.readdir(directory.directory, { withFileTypes: true });
		} catch (error) {
			if (error.code === 'ENOENT') {
				continue;
			}
			throw error;
		}

		for (const entry of entries) {
			if (!entry.isFile()) {
				continue;
			}

			const extension = path.extname(entry.name).toLowerCase();
			const mimeType = SUPPORTED_MIME_TYPES[extension];
			if (!mimeType) {
				continue;
			}

			templates.push({
				id: createTemplateId(directory.scopeLabel, entry.name),
				name: path.parse(entry.name).name,
				fileName: entry.name,
				scope: directory.scopeLabel,
				mimeType: mimeType
			});
		}
	}

	return templates;
}

function resolveTemplatePath(config, user, parsedTemplate) {
	if (parsedTemplate.scope === 'personal') {
		return path.join(config.templateRoot, 'personal', user.id, parsedTemplate.relativePath);
	}

	if (parsedTemplate.scope.startsWith('group:')) {
		const groupId = parsedTemplate.scope.slice('group:'.length);
		if (!user.groups.includes(groupId)) {
			throw createHttpError(403, 'Template group permission denied.');
		}
		return path.join(config.templateRoot, 'groups', groupId, parsedTemplate.relativePath);
	}

	if (parsedTemplate.scope === 'global' || parsedTemplate.scope === 'admin') {
		return path.join(config.templateRoot, parsedTemplate.scope, parsedTemplate.relativePath);
	}

	throw createHttpError(400, 'Invalid template scope.');
}

async function createDocumentFromTemplate(config, documentRoot, user, options) {
	const templateInfo = parseTemplateId(options.templateId);
	const templatePath = resolveTemplatePath(config, user, templateInfo);
	let templateContent;
	try {
		templateContent = await fs.readFile(templatePath);
	} catch (error) {
		if (error.code === 'ENOENT') {
			throw createHttpError(404, 'Template does not exist.');
		}
		throw error;
	}

	const templateFileName = path.basename(templatePath);
	const extension = path.extname(templateFileName).toLowerCase();
	const fileName = options.fileName || `${path.parse(templateFileName).name}${extension}`;
	return createDocument(documentRoot, {
		directory: options.directory,
		fileName: fileName,
		content: templateContent
	});
}

module.exports = {
	TEMPLATE_SCOPES: TEMPLATE_SCOPES,
	createDocumentFromTemplate: createDocumentFromTemplate,
	listTemplates: listTemplates
};
