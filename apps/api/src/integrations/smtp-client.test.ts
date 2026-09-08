import { createServer, type AddressInfo, type Server, type Socket } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import {
  SmtpError,
  buildMimeMessage,
  encodeWord,
  sendSmtpMail,
  verifySmtpConnection,
} from './smtp-client.js';

interface FakeSmtpOptions {
  readonly authResult?: 'ok' | 'reject';
  readonly rejectRecipient?: boolean;
  readonly silent?: boolean;
  readonly advertiseAuth?: boolean;
}

interface FakeSmtp {
  readonly port: number;
  readonly commands: string[];
  readonly messages: string[];
  close(): Promise<void>;
}

async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const commands: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    if (options.silent) return;
    let buffer = '';
    let data = false;
    let loginStep = 0;
    socket.write('220 fake.test ESMTP ready\r\n');
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\r\n');
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        index = buffer.indexOf('\r\n');
        if (data) {
          if (line === '.') {
            data = false;
            socket.write('250 2.0.0 Ok: queued as FAKE123\r\n');
          } else {
            messages[messages.length - 1] += `${line.startsWith('..') ? line.slice(1) : line}\r\n`;
          }
          continue;
        }
        commands.push(line);
        const upper = line.toUpperCase();
        if (upper.startsWith('EHLO')) {
          socket.write(
            options.advertiseAuth === false
              ? '250-fake.test\r\n250 8BITMIME\r\n'
              : '250-fake.test\r\n250-AUTH PLAIN LOGIN\r\n250 8BITMIME\r\n',
          );
        } else if (upper.startsWith('AUTH PLAIN')) {
          socket.write(
            options.authResult === 'reject' ? '535 5.7.8 denied\r\n' : '235 2.7.0 ok\r\n',
          );
        } else if (upper.startsWith('AUTH LOGIN')) {
          loginStep = 1;
          socket.write('334 VXNlcm5hbWU6\r\n');
        } else if (loginStep === 1) {
          loginStep = 2;
          socket.write('334 UGFzc3dvcmQ6\r\n');
        } else if (loginStep === 2) {
          loginStep = 0;
          socket.write('235 2.7.0 ok\r\n');
        } else if (upper.startsWith('MAIL FROM')) {
          socket.write('250 2.1.0 ok\r\n');
        } else if (upper.startsWith('RCPT TO')) {
          socket.write(options.rejectRecipient ? '550 5.1.1 no such user\r\n' : '250 2.1.5 ok\r\n');
        } else if (upper === 'DATA') {
          data = true;
          messages.push('');
          socket.write('354 go ahead\r\n');
        } else if (upper === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else {
          socket.write('500 unknown\r\n');
        }
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    port: (server.address() as AddressInfo).port,
    commands,
    messages,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of sockets) socket.destroy();
        server.close(() => resolve());
      }),
  };
}

describe('SMTP client', () => {
  const running: FakeSmtp[] = [];
  afterEach(async () => {
    await Promise.all(running.splice(0).map((server) => server.close()));
  });

  it('authenticates, submits a bilingual message and reports the queue id', async () => {
    const server = await startFakeSmtp();
    running.push(server);
    const result = await sendSmtpMail(
      {
        host: '127.0.0.1',
        port: server.port,
        security: 'none',
        username: 'mailer',
        password: 'pa ss',
        requireTlsForAuth: false,
        timeoutMs: 3_000,
      },
      {
        from: { address: 'noreply@orvex.test', name: 'أورفكس' },
        to: 'ops@example.test',
        subject: 'رمز التحقق · Code',
        text: 'Line one\n.leading dot\nمرحباً',
        html: '<p>مرحباً</p>',
      },
    );
    expect(result.response).toContain('FAKE123');
    expect(result.messageId).toMatch(/^<[0-9a-f-]+@orvex\.test>$/u);
    const plain = Buffer.from('\u0000mailer\u0000pa ss', 'utf8').toString('base64');
    expect(server.commands).toContain(`AUTH PLAIN ${plain}`);
    expect(server.commands).toContain('MAIL FROM:<noreply@orvex.test>');
    expect(server.commands).toContain('RCPT TO:<ops@example.test>');
    const raw = server.messages[0] ?? '';
    expect(raw).toContain('Subject: =?UTF-8?B?');
    expect(raw).toContain('Content-Type: multipart/alternative');
    expect(raw).not.toContain('pa ss');
    const encodedText = /Content-Type: text\/plain[\s\S]*?\r\n\r\n([\s\S]*?)\r\n--/u.exec(raw)?.[1];
    expect(Buffer.from((encodedText ?? '').replaceAll('\r\n', ''), 'base64').toString('utf8')).toBe(
      'Line one\r\n.leading dot\r\nمرحباً',
    );
  });

  it('never sends credentials over a cleartext session when TLS is required', async () => {
    const server = await startFakeSmtp();
    running.push(server);
    await expect(
      verifySmtpConnection({
        host: '127.0.0.1',
        port: server.port,
        security: 'none',
        username: 'mailer',
        password: 'secret',
        requireTlsForAuth: true,
      }),
    ).rejects.toMatchObject({ code: 'SMTP_TLS_REQUIRED' });
    expect(server.commands.some((command) => command.startsWith('AUTH'))).toBe(false);
  });

  it('maps authentication, recipient and transport failures to error codes', async () => {
    const denied = await startFakeSmtp({ authResult: 'reject' });
    running.push(denied);
    await expect(
      verifySmtpConnection({
        host: '127.0.0.1',
        port: denied.port,
        security: 'none',
        username: 'mailer',
        password: 'wrong',
        requireTlsForAuth: false,
      }),
    ).rejects.toMatchObject({ code: 'SMTP_AUTH' });

    const rejecting = await startFakeSmtp({ rejectRecipient: true });
    running.push(rejecting);
    await expect(
      sendSmtpMail(
        { host: '127.0.0.1', port: rejecting.port, security: 'none' },
        { from: { address: 'a@b.test' }, to: 'nobody@b.test', subject: 's', text: 't' },
      ),
    ).rejects.toMatchObject({ code: 'SMTP_REJECTED' });

    const silent = await startFakeSmtp({ silent: true });
    running.push(silent);
    await expect(
      verifySmtpConnection({
        host: '127.0.0.1',
        port: silent.port,
        security: 'none',
        timeoutMs: 300,
      }),
    ).rejects.toMatchObject({ code: 'SMTP_TIMEOUT' });

    const noAuth = await startFakeSmtp({ advertiseAuth: false });
    running.push(noAuth);
    const failure = await verifySmtpConnection({
      host: '127.0.0.1',
      port: noAuth.port,
      security: 'none',
      username: 'mailer',
      password: 'x',
      requireTlsForAuth: false,
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(SmtpError);
    expect((failure as SmtpError).code).toBe('SMTP_AUTH');

    await expect(
      verifySmtpConnection({ host: '127.0.0.1', port: 1, security: 'none', timeoutMs: 1_000 }),
    ).rejects.toMatchObject({ code: 'SMTP_CONNECT' });
  });

  it('builds RFC 2047 headers without splitting multi-byte characters', () => {
    expect(encodeWord('plain ascii')).toBe('plain ascii');
    const encoded = encodeWord('رمز التحقق الخاص بك في Orvex ISP هو جاهز الآن للاستخدام');
    for (const word of encoded.split('\r\n ')) {
      expect(word.length).toBeLessThanOrEqual(75);
      const body = /^=\?UTF-8\?B\?(.*)\?=$/u.exec(word)?.[1] ?? '';
      expect(Buffer.from(body, 'base64').toString('utf8')).not.toContain('�');
    }
    const { raw } = buildMimeMessage(
      { from: { address: 'a@b.test' }, to: 'c@d.test', subject: 'x', text: 'y' },
      'orvex-isp',
      new Date('2026-09-07T10:00:00.000Z'),
    );
    expect(raw).toContain('Date: Mon, 07 Sep 2026 10:00:00 GMT');
    expect(raw).toContain('MIME-Version: 1.0');
  });
});
