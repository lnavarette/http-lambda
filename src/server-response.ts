import IncomingMessage from './incoming-message';
import _ from 'lodash-firecloud';
import http from 'http';

import {
  Context,
  Next
} from './types';

declare module 'http' {
  interface OutgoingMessage {
    end(data?: any, encoding?, cb?: () => void): void;
  }

  interface ServerResponse {
    _header: string;
    _headers: {
      [key: string]: string | string[];
    };
  }
}

type WriteRawCallback = (err?: Error) => void;

export class ServerResponse extends http.ServerResponse {
  _next: Next;

  _body: Buffer;

  _isBinary: boolean;

  ctx: Context;

  // eslint-disable-next-line max-params
  constructor(req: IncomingMessage, ctx: Context, next: Next) {
    super(req);
    this._body = Buffer.from('');

    this.ctx = ctx;
    this._next = next;
    this._isBinary = false;

    // NOTE express sets the __proto__ to http.ServerResponse
    _.forEach([
      '_writeRaw',
      'addTrailers',
      'end',
      'writeHead'
    ], (method) => {
      // @ts-ignore
      // eslint-disable-next-line no-proto
      this[method] = this.__proto__[method].bind(this);
    });
  }

  /* eslint-disable no-dupe-class-members */
  _writeRaw(data: Buffer, _callback?: WriteRawCallback): void;

  _writeRaw(data: Buffer, encoding: string, _callback?: WriteRawCallback): void;

  _writeRaw(data: Buffer, encodingOrCallback: string | WriteRawCallback, _callback?: WriteRawCallback): void {
    let encoding;
    if (_.isFunction(encodingOrCallback)) {
      _callback = encodingOrCallback;
      encoding = undefined;
    } else {
      encoding = encodingOrCallback;
    }

    // see https://nodejs.org/api/buffer.html#buffer_buffers_and_character_encodings
    if (encoding === 'binary') {
      this._isBinary = true;
    }

    if (_.isBuffer(data)) {
      this._body = Buffer.concat([
        this._body,
        data
      ]);
    } else if (_.isString(data)) {
      this._body = Buffer.concat([
        this._body,
        Buffer.from(data, encoding)
      ]);
    } else {
      throw new Error('ServerResponse._writeRaw expects Buffer or string');
    }
  }
  /* eslint-enable no-dupe-class-members */

  // eslint-disable-next-line class-methods-use-this
  addTrailers(_headers: http.OutgoingHttpHeaders | [string, string][]): void {
    // not supported
  }

  end(data?: any, encoding?: any, _cb?: () => void): void {
    super.end(data, encoding);

    // API Gateway doesn't support multiple headers (yet)
    // case #1951724541
    let headers = _.mapValues(this._headers, function(header) {
      // NOTE this is a very naïve "solution" since the semantics are header based,
      // while here we assume that all the values of a header MUST be joined by a comma
      if (_.isArray(header)) {
        header = header.join(', ');
      }

      return _.toString(header);
    });

    let body = this._body.toString(this._isBinary ? 'base64' : undefined);
    // FIXME
    // body = this._contentLength ? body : undefined;

    this._next(undefined, {
      // see https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
      isBase64Encoded: this._isBinary,
      statusCode: this.statusCode,
      // API Gateway doesn't support statusMessage (yet)
      // statusMessage: this.statusMessage || http.STATUS_CODES[this.statusCode],
      headers,
      body
    });
  }

  writeHead(
    statusCode: number,
    reasonPhrase?: string | http.OutgoingHttpHeaders,
    headers?: http.OutgoingHttpHeaders
  ): this {
    if (_.isString(reasonPhrase)) {
      super.writeHead(statusCode, reasonPhrase, headers);
    } else {
      headers = reasonPhrase;
      super.writeHead(statusCode, headers);
    }

    // we want this._body to be just the body on this.end
    this._header = '';
    return this;
  }
}

export default ServerResponse;
