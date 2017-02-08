# Image Proxy

A simple Express app for proxying and manipulating images, specifically headshots.

This proxy has been adapted from [https://github.com/jpmckinney/image-proxy](https://github.com/jpmckinney/image-proxy),
thank you James for releasing the code under a permissive license, it was quite the time saver!

USE AT YOUR OWN RISK!

## Getting Started

    npm install
    npm start

The URL structure is `/?url=$url&f=$format`. The `url` parameter must be escaped/encoded.

The $format parameter supports the following parameters:

| Paramter | Value   | Description                                          | Example       |
|----------|---------|------------------------------------------------------|---------------|
| re       | w, wxh  | image resizing                                       | 200, 200x400  |
| ro       | r       | image rotation, supports angles dividable by 90 only | 90            |
| ex       | lxtxwxh | extracts the specified area from the image           | 10x10x100x100 |
| fx       | 1       | flips the image along the x axis                     | 1             |
| fy       | 1       | flips the image along the y axis                     | 1             |

The order in which the statements are executed are specified by [the API doc](http://sharp.dimens.io/en/stable/api-operation/)
and the order they are provided in. Image manipulation instructions are separated by ",", key and value are separated by
 "-". Please note that not all sharp manipulations are accepted yet.

Example: http://localhost:3000/?url=MYURL&f=re-100,ex-0x0x10x10,ro-90

## Features

Image proxy:

* Supports HTTP and HTTPS
* Follows 301 and 302 redirects
* Sets a maximum timeout for the remote server
* Handles complex MIME types like `image/jpeg; charset=utf-8`
* Optional whitelisting using regular expressions
* Fully configurable
* Rudimentary caching support
* Sharp based image manipulation

HTTP server:

* Adds a Cache-Control header

## Testing

    npm test

## Acknowledgements

This project is inspired by [node-connect-image-proxy](https://github.com/mysociety/node-connect-image-proxy).

Copyright (c) 2013 James McKinney, released under the MIT license
Copyright (c) 2017 Spherical Elephant GmbH, released under the MIT license