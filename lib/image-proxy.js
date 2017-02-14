const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const mime = require('mime');
const url = require('url');
const nconf = require('nconf');
const sharp = require('sharp');
const packageJson = require('../package.json');
const path = require('path');
const md5 = require('md5');
const logger = require('winston');

const app = express();

module.exports = function () {

    app.get('/', function (req, res, next) {
        if (!req.query.url)
            return res.status(400).send('No url set!');

        const imageUrl = new url.parse(req.query.url);
        const format = req.query.f;

        const fileName = path.basename(imageUrl.pathname);
        const splitFileName = fileName.split('.');
        const extension = splitFileName[splitFileName.length - 1];

        const retrieve = function (remote) {
            // @see http://nodejs.org/api/url.html#url_url
            const options = url.parse(remote);
            // @see https://github.com/substack/hyperquest
            options.agent = false;
            if (options.protocol !== 'http:' && options.protocol !== 'https:') {
                return res.status(404).send('Expected URI scheme to be HTTP or HTTPS');
            }
            if (!options.hostname) {
                return res.status(404).send('Expected URI host to be non-empty');
            }
            options.headers = {'User-Agent': packageJson.name + '/' + packageJson.version, 'Accept': '*/*'};

            var timeout = false;

            const agent = options.protocol === 'http:' ? http : https;

            // @see http://nodejs.org/api/http.html#http_http_get_options_callback
            const request = agent.get(options, function (response) {
                if (timeout) {
                    // Status code 504 already sent.
                    return;
                }

                // @see http://nodejs.org/api/http.html#http_response_statuscode
                if ((response.statusCode === 301 || response.statusCode === 302) && response.headers['location']) {
                    const redirect = url.parse(response.headers['location']);
                    // @see https://tools.ietf.org/html/rfc7231#section-7.1.2
                    if (!redirect.protocol) {
                        redirect.protocol = options.protocol;
                    }
                    if (!redirect.hostname) {
                        redirect.hostname = options.hostname;
                    }
                    if (!redirect.port) {
                        redirect.port = options.port;
                    }
                    if (!redirect.hash) {
                        redirect.hash = options.hash;
                    }
                    return retrieve(url.format(redirect));
                }

                // The image must return status code 200.
                if (response.statusCode !== 200) {
                    return res.status(404).send('Expected response code 200, got ' + response.statusCode);
                }

                // The image must be a valid content type.
                // @see http://nodejs.org/api/http.html#http_request_headers
                var mimeType;
                var fileExtension;
                if (extension) {
                    mimeType = mime.lookup(extension);
                    fileExtension = extension;
                } else {
                    mimeType = (response.headers['content-type'] || '').replace(/;.*/, '');
                    fileExtension = mime.extension(mimeType);
                }
                var mimeTypes = nconf.get('mimeTypes');
                if (mimeTypes.indexOf(mimeType) === -1) {
                    return res.status(404).send('Expected content type ' + mimeTypes.join(', ') + ', got ' + mimeType);
                }
                var data = null;
                response.on('data', d => {
                    if (data === null) data = d;
                    else data = Buffer.concat([data, d]);
                });
                response.on('end', () => {
                    sharpen(data, format, fileExtension, (err, buffer, fromCache) => {
                        if (err) return res.status(400).send('Invalid format string ' + err);
                        const cacheFileName = getCacheFileName(data, format, fileExtension);
                        if (fromCache) logger.info('Cache hit! ' + cacheFileName);
                        res.writeHead(200, {
                            'Content-Type': mimeType,
                            'Cache-Control': 'max-age=' + nconf.get('cacheControlHeaderTTL') + ', public',
                        });
                        res.write(buffer, () => {
                            if (nconf.get('cache') && !fromCache) {

                                cache(cacheFileName, buffer, (err, fileName) => {
                                    if (err) res.status(500).send('Could not cache file! ' + err);
                                    logger.info('File cached! ' + fileName);
                                });
                            }
                            res.end();
                        });
                    });
                });
            }).on('error', next);

            request.setTimeout(nconf.get('requestTimeout'), function () {
                timeout = true;
                return res.status(504).send();
            });
        };

        const _getCacheFileName = (cachePath, buffer, format, fileExtension) => {
            const checkSum = md5(buffer);
            const fileName = checkSum + '_' + (format ? format.split(',').join('_') : 'normal') + '.' + fileExtension;
            return path.join(cachePath, fileName);
        };

        const getCacheFileName = _getCacheFileName.bind(null, nconf.get('cacheFolder'));

        const cache = (cacheFilePath, buffer, cb) => {
            fs.writeFile(cacheFilePath, buffer, 'binary', err => {
                if (err) return cb(err);
                return cb(null, cacheFilePath);
            });
        };

        const sharpen = (data, format, fileExtension, cb) => {
            if (!format) {
                return cb(null, data, true);
            }
            const cacheFilePath = getCacheFileName(data, format, fileExtension);
            fs.readFile(cacheFilePath, (err, cacheFileData) => {
                if (err) {
                    logger.info('Not in cache! ' + cacheFilePath);
                    const sharpened = sharp(data);
                    const formatStrings = format.split(',');
                    for (let i = 0; i < formatStrings.length; i++) {
                        const formatString = formatStrings[i];
                        const splitFormatString = formatString.split('-');
                        if (splitFormatString.length != 2)
                            return cb(new Error('Invalid format string format: ' + formatString));
                        const action = splitFormatString[0];

                        const parameters = splitFormatString[1];
                        const splitParameters = parameters.split('x');
                        const intParameters = [];

                        for (let i = 0; i < splitParameters.length; i++) {
                            const intParameter = parseInt(splitParameters[i]);
                            if (isNaN(parseInt(intParameter)))
                                return cb(new Error('Invalid parameter part, not an int ' + parameters));
                            intParameters.push(intParameter);
                        }

                        const validationError = validateAction(action, intParameters);
                        if (validationError !== null) return cb(validationError);
                        try {
                            switch (action) {
                                case 're':
                                    sharpened.resize(...intParameters);
                                    break;
                                case 'ro':
                                    sharpened.rotate(...intParameters);
                                    break;
                                case 'ex':
                                    sharpened.extract({
                                        left: intParameters[0],
                                        top: intParameters[1],
                                        width: intParameters[2],
                                        height: intParameters[3]
                                    });
                                    break;
                                case 'fx':
                                    sharpened.flop(...intParameters);
                                    break;
                                case 'fy':
                                    sharpened.flip(...intParameters);
                                    break;
                                default:
                                    return cb(new Error('Invalid format action: ' + action));
                            }
                        } catch (err) {
                            return cb(err);
                        }
                    }
                    sharpened.toBuffer((err, buffer, info) => {
                        if (err) return cb(err);
                        return cb(null, buffer, false);
                    });
                } else {
                    return cb(null, cacheFileData, true);
                }
            });
        };

        const validateAction = (action, parameters) => {
            var invalid = false;
            switch (action) {
                case 're':
                    invalid = (parameters.length > 2);
                    break;
                case 'ro':
                    invalid = (parameters.length !== 1);
                    break;
                case 'ex':
                    invalid = (parameters.length !== 4);
                    break;
                case 'fx':
                    invalid = (parameters.length !== 1);
                    break;
                case 'fy':
                    invalid = (parameters.length !== 1);
                    break;
                default:
                    return new Error('Invalid format action: ' + action);
            }
            if (invalid) return cb(new Error('Invalid parameters for ' + action + ' ' + parameters));
            return null;
        };

        var whitelist = nconf.get('whitelist');

        // Validate parameters.
        if (whitelist.length) {
            const parts = url.parse(req.params.url);
            if (parts.hostname) {
                var any = false;
                if (typeof whitelist === 'string') {
                    whitelist = whitelist.split(',');
                }
                for (let _i = 0, _len = whitelist.length; _i < _len; _i++) {
                    if (typeof whitelist[_i] === 'string') {
                        // Escape periods and add anchor.
                        whitelist[_i] = new RegExp(whitelist[_i].replace('.', '\\.') + '$')
                    }
                    if (whitelist[_i].test(parts.hostname)) {
                        any = true;
                        break;
                    }
                }
                if (!any) { // if none
                    return res.status(400).send('Expected URI host to be whitelisted');
                }
            }
        }
        retrieve(imageUrl);
    });

    return app;
};
