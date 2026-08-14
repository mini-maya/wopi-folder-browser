'use strict';

const express = require('express');
const path = require('path');
const logger = require('morgan');
const bodyParser = require('body-parser');

const config = require('./lib/config');
const apiRouter = require('./routes/api');
const wopiRouter = require('./routes/wopi');

const app = express();

app.disable('x-powered-by');
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

app.get('/health', function(req, res) {
	res.json({ status: 'ok' });
});

app.get('/', function(req, res) {
	res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.get('/share/:shareId', function(req, res) {
	res.sendFile(path.join(__dirname, 'html/index.html'));
});

app.use('/api', apiRouter);
app.use('/wopi', bodyParser.raw({ type: '*/*', limit: config.maxDocumentSize }), wopiRouter);
app.use(express.static(path.join(__dirname, 'html')));

app.use(function(err, req, res, next) {
	console.error(err);
	const status = err.status || 500;
	const message = err.message || 'Internal Server Error';
	if (req.path.startsWith('/api') || req.path.startsWith('/wopi')) {
		res.status(status).json({ error: message });
		return;
	}

	res.status(status).send(message);
});

module.exports = app;
