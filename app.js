'use strict';

const express = require('express');
const path = require('path');
const logger = require('morgan');
const bodyParser = require('body-parser');
const cookieParser = require('cookie-parser');

const config = require('./lib/config');
const adminRouter = require('./routes/admin');
const apiRouter = require('./routes/api');
const authRouter = require('./routes/auth');
const wopiRouter = require('./routes/wopi');
const { attachAuthContext, createSessionMiddleware } = require('./lib/sessionAuth');
const { ensureStorageLayout, getResolvedStorageContext } = require('./lib/storageContext');
const userStore = require('./lib/userStore');

const app = express();

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(createSessionMiddleware(config));
app.use(attachAuthContext(config, userStore));
app.use(async function(req, res, next) {
	try {
		await ensureStorageLayout(config);
		req.storageContext = getResolvedStorageContext(req, config);
		next();
	} catch (error) {
		next(error);
	}
});

app.get('/health', function(req, res) {
	res.json({ status: 'ok' });
});

app.get('/', function(req, res) {
	res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.get('/share/:shareId', function(req, res) {
	res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.use('/api/auth', authRouter);
app.use('/api/admin', adminRouter);
app.use('/api', apiRouter);
app.use('/wopi', bodyParser.raw({ type: '*/*', limit: config.maxDocumentSize }), wopiRouter);
app.use(express.static(path.join(__dirname, 'html')));

app.use(function(err, req, res, next) {
	console.error(err);
	const status = err.status || 500;
	const message = err.message || 'Internal Server Error';
	if (req.path.startsWith('/api') || req.path.startsWith('/wopi')) {
		const payload = { error: err.code || message };
		if (err.details && typeof err.details === 'object') {
			Object.assign(payload, err.details);
		}
		if (!payload.message) {
			payload.message = message;
		}
		res.status(status).json(payload);
		return;
	}

	res.status(status).send(message);
});

module.exports = app;
