// @see https://devcenter.heroku.com/articles/nodejs#write-your-app

const express = require('express');
const fs = require('fs');
const http = require('http');
const https = require('https');
const mime = require('mime');
const url = require('url');
const nconf = require('nconf');
const sharp = require('sharp');
const packageJson = require('../package.json');

const app = express();

module.exports = function () {

    app.get('/:url/:width/:height.:extension?', function (req, res, next) {
        const width = req.params.width;
        const height = req.params.height;
        var extension = req.params.extension;
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
                if (extension) {
                    mimeType = mime.lookup(extension);
                }
                else {
                    mimeType = (response.headers['content-type'] || '').replace(/;.*/, '');
                    extension = mime.extension(mimeType);
                }
                var mimeTypes = nconf.get('mimeTypes');
                if (mimeTypes.indexOf(mimeType) === -1) {
                    return res.status(404).send('Expected content type ' + mimeTypes.join(', ') + ', got ' + mimeType);
                }

                // @see https://github.com/aheckmann/gm#constructor
                imageMagick(response, 'image.' + extension)
                    .colorspace('RGB')
                    // @see http://www.imagemagick.org/Usage/thumbnails/#cut
                    .resize(width, height + '^>')
                    .gravity('Center') // faces are most often near the center
                    .extent(width, height)
                    .stream(extension, function (err, stdout, stderr) {
                        if (err) return next(err);
                        // Log errors in production.
                        stderr.pipe(process.stderr);
                        // @see http://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/Expiration.html
                        res.writeHead(200, {
                            'Content-Type': mimeType,
                            'Cache-Control': 'max-age=31536000, public', // 1 year
                        });
                        stdout.pipe(res);
                    });
            }).on('error', next);

            // Timeout after five seconds. Better luck next time.
            request.setTimeout(nconf.get('requestTimeout'), function () {
                timeout = true; // if we abort, we'll get a "socket hang up" error
                return res.status(504).send();
            });
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
                    return res.status(404).send('Expected URI host to be whitelisted');
                }
            }
        }
        if (isNaN(parseInt(width))) {
            return res.status(404).send('Expected width to be an integer');
        }
        if (parseInt(width) > 1000) {
            return res.status(404).send('Expected width to be less than or equal to 1000');
        }
        if (isNaN(parseInt(height))) {
            return res.status(404).send('Expected height to be an integer');
        }
        if (parseInt(height) > 1000) {
            return res.status(404).send('Expected height to be less than or equal to 1000');
        }

        retrieve(req.params.url);
    });

    return app;
};
