import { randomUUID } from 'node:crypto';
import { connect as connectPlain, type Socket } from 'node:net';
import { connect as connectTls, type TLSSocket } from 'node:tls';

/**
 * A deliberately small SMTP client (RFC 5321 submission with EHLO, STARTTLS, AUTH PLAIN/LOGIN and
 * a single DATA transaction). It exists so provider credentials configured in the product can be
 * exercised and used without pulling a mail library into the API runtime.
 */
export type SmtpErrorCode =
  | 'SMTP_CONNECT'
  | 'SMTP_TIMEOUT'
  | 'SMTP_TLS'
  | 'SMTP_TLS_REQUIRED'
  | 'SMTP_AUTH'
  | 'SMTP_REJECTED'
  | 'SMTP_PROTOCOL';

export class SmtpError extends Error {
  public constructor(
    public readonly code: SmtpErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

export interface SmtpConnectionOptions {
  readonly host: string;
  readonly port: number;
  readonly security: 'starttls' | 'tls' | 'none';
  readonly username?: string;
  readonly password?: string;
  readonly timeoutMs?: number;
  /** Refuse to send credentials over a cleartext session. Always true in production. */
  readonly requireTlsForAuth?: boolean;
  readonly clientName?: string;
}

export interface MailAddress {
  readonly address: string;
  readonly name?: string;
}

export interface MailMessage {
  readonly from: MailAddress;
  readonly to: string;
  readonly replyTo?: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

export interface SmtpSendResult {
  readonly messageId: string;
  readonly response: string;
}

export interface SmtpVerifyResult {
  readonly greeting: string;
  readonly extensions: readonly string[];
  readonly authenticated: boolean;
  readonly tls: boolean;
}

interface SmtpResponse {
  readonly code: number;
  readonly lines: readonly string[];
}

export async function verifySmtpConnection(
  options: SmtpConnectionOptions,
): Promise<SmtpVerifyResult> {
  const session = await SmtpSession.open(options);
  try {
    return session.summary();
  } finally {
    await session.quit();
  }
}

export async function sendSmtpMail(
  options: SmtpConnectionOptions,
  message: MailMessage,
): Promise<SmtpSendResult> {
  const session = await SmtpSession.open(options);
  try {
    return await session.send(message);
  } finally {
    await session.quit();
  }
}

class SmtpSession {
  private socket: Socket | TLSSocket;
  private buffer = '';
  private pending:
    | {
        readonly resolve: (response: SmtpResponse) => void;
        readonly reject: (error: Error) => void;
      }
    | undefined;
  private closed = false;
  private greeting = '';
  private extensions: string[] = [];
  private authenticated = false;
  private secure: boolean;

  private constructor(
    socket: Socket | TLSSocket,
    private readonly options: SmtpConnectionOptions,
  ) {
    this.socket = socket;
    this.secure = options.security === 'tls';
    this.attach(socket);
  }

  public static async open(options: SmtpConnectionOptions): Promise<SmtpSession> {
    const timeoutMs = options.timeoutMs ?? 15_000;
    const socket = await new Promise<Socket | TLSSocket>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingSocket.destroy();
        reject(
          new SmtpError('SMTP_TIMEOUT', `Connecting to ${options.host}:${options.port} timed out.`),
        );
      }, timeoutMs);
      const settle = (error?: Error) => {
        clearTimeout(timer);
        if (error) reject(error);
        else resolve(pendingSocket);
      };
      const pendingSocket: Socket | TLSSocket =
        options.security === 'tls'
          ? connectTls({ host: options.host, port: options.port, servername: options.host }, () =>
              settle(),
            )
          : connectPlain({ host: options.host, port: options.port }, () => settle());
      pendingSocket.once('error', (error: Error) =>
        settle(
          new SmtpError(
            options.security === 'tls' ? 'SMTP_TLS' : 'SMTP_CONNECT',
            `Could not connect to ${options.host}:${options.port} (${describe(error)}).`,
          ),
        ),
      );
    });
    socket.setTimeout(timeoutMs);
    const session = new SmtpSession(socket, options);
    try {
      await session.handshake();
    } catch (error) {
      await session.quit();
      throw error;
    }
    return session;
  }

  public summary(): SmtpVerifyResult {
    return {
      greeting: this.greeting,
      extensions: [...this.extensions],
      authenticated: this.authenticated,
      tls: this.secure,
    };
  }

  public async send(message: MailMessage): Promise<SmtpSendResult> {
    const { messageId, raw } = buildMimeMessage(message, this.options.clientName ?? 'orvex-isp');
    await this.command(`MAIL FROM:<${message.from.address}>`, [250], 'SMTP_REJECTED');
    await this.command(`RCPT TO:<${message.to}>`, [250, 251], 'SMTP_REJECTED');
    await this.command('DATA', [354], 'SMTP_REJECTED');
    const response = await this.command(`${dotStuff(raw)}\r\n.`, [250], 'SMTP_REJECTED');
    return { messageId, response: response.lines.join(' ') };
  }

  public async quit(): Promise<void> {
    if (this.closed) return;
    try {
      this.socket.write('QUIT\r\n');
    } catch {
      /* The session is being discarded regardless of the server's answer. */
    }
    this.closed = true;
    this.socket.destroy();
  }

  private async handshake(): Promise<void> {
    const greeting = await this.expect([220], 'SMTP_PROTOCOL');
    this.greeting = greeting.lines.join(' ');
    await this.ehlo();
    if (this.options.security === 'starttls') {
      if (!this.extensions.includes('STARTTLS')) {
        throw new SmtpError('SMTP_TLS', 'The server does not offer STARTTLS on this port.');
      }
      await this.command('STARTTLS', [220], 'SMTP_TLS');
      await this.upgrade();
      await this.ehlo();
    }
    if (this.options.username !== undefined) {
      if (!this.secure && (this.options.requireTlsForAuth ?? true)) {
        throw new SmtpError(
          'SMTP_TLS_REQUIRED',
          'Credentials are only sent over TLS or STARTTLS sessions.',
        );
      }
      await this.authenticate(this.options.username, this.options.password ?? '');
    }
  }

  private async ehlo(): Promise<void> {
    const name = this.options.clientName ?? 'orvex-isp';
    let response: SmtpResponse;
    try {
      response = await this.command(`EHLO ${name}`, [250], 'SMTP_PROTOCOL');
    } catch (error) {
      if (!(error instanceof SmtpError) || error.code !== 'SMTP_PROTOCOL') throw error;
      response = await this.command(`HELO ${name}`, [250], 'SMTP_PROTOCOL');
    }
    this.extensions = response.lines
      .slice(1)
      .map((line) => line.trim().toUpperCase())
      .filter((line) => line.length > 0);
  }

  private async authenticate(username: string, password: string): Promise<void> {
    const mechanisms = this.extensions
      .filter((line) => line.startsWith('AUTH '))
      .flatMap((line) => line.slice(5).split(/\s+/u));
    if (mechanisms.includes('PLAIN')) {
      const token = Buffer.from(`\u0000${username}\u0000${password}`, 'utf8').toString('base64');
      await this.command(`AUTH PLAIN ${token}`, [235], 'SMTP_AUTH');
    } else if (mechanisms.includes('LOGIN')) {
      await this.command('AUTH LOGIN', [334], 'SMTP_AUTH');
      await this.command(Buffer.from(username, 'utf8').toString('base64'), [334], 'SMTP_AUTH');
      await this.command(Buffer.from(password, 'utf8').toString('base64'), [235], 'SMTP_AUTH');
    } else {
      throw new SmtpError(
        'SMTP_AUTH',
        'The server offers no supported AUTH mechanism (PLAIN/LOGIN).',
      );
    }
    this.authenticated = true;
  }

  private upgrade(): Promise<void> {
    return new Promise((resolve, reject) => {
      const plain = this.socket;
      plain.removeAllListeners('data');
      plain.removeAllListeners('error');
      plain.removeAllListeners('close');
      plain.removeAllListeners('timeout');
      const secure = connectTls({ socket: plain, servername: this.options.host }, () => {
        this.socket = secure;
        this.secure = true;
        this.buffer = '';
        secure.setTimeout(this.options.timeoutMs ?? 15_000);
        this.attach(secure);
        resolve();
      });
      secure.once('error', (error: Error) =>
        reject(new SmtpError('SMTP_TLS', `STARTTLS negotiation failed (${describe(error)}).`)),
      );
    });
  }

  private attach(socket: Socket | TLSSocket): void {
    socket.on('data', (chunk: Buffer) => this.consume(chunk.toString('utf8')));
    socket.on('error', (error: Error) =>
      this.fail(new SmtpError('SMTP_CONNECT', `SMTP connection failed (${describe(error)}).`)),
    );
    socket.on('timeout', () => {
      this.fail(new SmtpError('SMTP_TIMEOUT', 'The SMTP server stopped responding.'));
      socket.destroy();
    });
    socket.on('close', () => {
      this.closed = true;
      this.fail(new SmtpError('SMTP_PROTOCOL', 'The SMTP server closed the connection.'));
    });
  }

  private consume(text: string): void {
    this.buffer += text;
    const lines = this.buffer.split('\r\n');
    this.buffer = lines.pop() ?? '';
    const complete: string[] = [];
    for (const line of lines) {
      complete.push(line);
      if (/^\d{3}(?: |$)/u.test(line)) {
        const pending = this.pending;
        this.pending = undefined;
        const code = Number(line.slice(0, 3));
        pending?.resolve({
          code,
          lines: complete.map((entry) => entry.slice(4)),
        });
        complete.length = 0;
      }
    }
    if (complete.length > 0) {
      // Put unterminated multi-line fragments back so the next chunk completes them.
      this.buffer = `${complete.join('\r\n')}\r\n${this.buffer}`;
    }
  }

  private fail(error: Error): void {
    const pending = this.pending;
    this.pending = undefined;
    pending?.reject(error);
  }

  private expect(codes: readonly number[], failure: SmtpErrorCode): Promise<SmtpResponse> {
    return new Promise<SmtpResponse>((resolve, reject) => {
      if (this.closed) {
        reject(new SmtpError('SMTP_PROTOCOL', 'The SMTP session is closed.'));
        return;
      }
      this.pending = { resolve, reject };
    }).then((response) => {
      if (!codes.includes(response.code)) {
        throw new SmtpError(
          response.code >= 500 && failure === 'SMTP_PROTOCOL' ? 'SMTP_PROTOCOL' : failure,
          `${response.code} ${response.lines.join(' ')}`.slice(0, 300),
        );
      }
      return response;
    });
  }

  private command(
    line: string,
    codes: readonly number[],
    failure: SmtpErrorCode,
  ): Promise<SmtpResponse> {
    const promise = this.expect(codes, failure);
    this.socket.write(`${line}\r\n`);
    return promise;
  }
}

function describe(error: Error): string {
  return error.message.replace(/\s+/gu, ' ').slice(0, 160);
}

function dotStuff(raw: string): string {
  return raw
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

/** Builds an RFC 5322 message with UTF-8 headers and base64 bodies (Arabic-safe on every relay). */
export function buildMimeMessage(
  message: MailMessage,
  clientName: string,
  date: Date = new Date(),
): { readonly messageId: string; readonly raw: string } {
  const domain = message.from.address.split('@')[1] ?? clientName;
  const messageId = `<${randomUUID()}@${domain}>`;
  const boundary = `=_orvex_${randomUUID().replaceAll('-', '')}`;
  const headers = [
    `From: ${formatAddress(message.from)}`,
    `To: <${message.to}>`,
    ...(message.replyTo ? [`Reply-To: <${message.replyTo}>`] : []),
    `Subject: ${encodeWord(message.subject)}`,
    `Date: ${date.toUTCString()}`,
    `Message-ID: ${messageId}`,
    'MIME-Version: 1.0',
    'X-Mailer: Orvex ISP',
  ];
  const textPart = [
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    base64Lines(message.text),
  ].join('\r\n');
  let body: string;
  if (message.html) {
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    const htmlPart = [
      'Content-Type: text/html; charset=UTF-8',
      'Content-Transfer-Encoding: base64',
      '',
      base64Lines(message.html),
    ].join('\r\n');
    body = [`--${boundary}`, textPart, `--${boundary}`, htmlPart, `--${boundary}--`, ''].join(
      '\r\n',
    );
  } else {
    headers.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    body = base64Lines(message.text);
  }
  return { messageId, raw: `${headers.join('\r\n')}\r\n\r\n${body}` };
}

function formatAddress(address: MailAddress): string {
  if (!address.name) return `<${address.address}>`;
  const encoded = encodeWord(address.name);
  const display = encoded === address.name ? `"${address.name.replaceAll('"', '')}"` : encoded;
  return `${display} <${address.address}>`;
}

/** RFC 2047 encoded-words for any header with non-ASCII text, split so no word exceeds 75 chars. */
export function encodeWord(value: string): string {
  if (/^[\x20-\x7e]*$/u.test(value)) return value;
  const words: string[] = [];
  let chunk = '';
  for (const character of value) {
    if (Buffer.byteLength(chunk + character, 'utf8') > 42) {
      words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
      chunk = '';
    }
    chunk += character;
  }
  if (chunk) words.push(`=?UTF-8?B?${Buffer.from(chunk, 'utf8').toString('base64')}?=`);
  return words.join('\r\n ');
}

function base64Lines(value: string): string {
  const encoded = Buffer.from(value.replaceAll(/\r?\n/gu, '\r\n'), 'utf8').toString('base64');
  return encoded.match(/.{1,76}/gu)?.join('\r\n') ?? '';
}
