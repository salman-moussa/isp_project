/**
 * Bilingual (English + Arabic) message bodies for platform-originated mail and test messages.
 * Users have no stored language preference, so every message carries both languages.
 */
export interface MailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

const PRODUCT = 'Orvex ISP';

export function otpMail(input: {
  readonly code: string;
  readonly expiresAt: Date;
  readonly displayName: string;
}): MailContent {
  const minutes = Math.max(1, Math.round((input.expiresAt.getTime() - Date.now()) / 60_000));
  const en = [
    `Hello ${input.displayName},`,
    `Your ${PRODUCT} verification code is: ${input.code}`,
    `It expires in about ${minutes} minute(s). If you did not request it, ignore this message and tell your administrator.`,
  ];
  const ar = [
    `مرحباً ${input.displayName}،`,
    `رمز التحقق الخاص بك في ${PRODUCT} هو: ${input.code}`,
    `تنتهي صلاحيته خلال نحو ${minutes} دقيقة. إذا لم تطلبه، تجاهل هذه الرسالة وأبلغ مدير النظام.`,
  ];
  return compose(`${PRODUCT} verification code ${input.code} · رمز التحقق`, en, ar, input.code);
}

export function recoveryMail(input: {
  readonly displayName: string;
  readonly link: string;
  readonly expiresAt: Date;
}): MailContent {
  const until = input.expiresAt.toISOString();
  const en = [
    `Hello ${input.displayName},`,
    `A password reset was requested for your ${PRODUCT} account. Open the link below to choose a new password:`,
    input.link,
    `The link expires at ${until} (UTC). If you did not request a reset, ignore this message.`,
  ];
  const ar = [
    `مرحباً ${input.displayName}،`,
    `طُلبت إعادة تعيين كلمة المرور لحسابك في ${PRODUCT}. افتح الرابط أدناه لاختيار كلمة مرور جديدة:`,
    input.link,
    `تنتهي صلاحية الرابط في ${until} (بالتوقيت العالمي). إذا لم تطلب إعادة التعيين، تجاهل هذه الرسالة.`,
  ];
  return compose(`${PRODUCT} password reset · إعادة تعيين كلمة المرور`, en, ar, input.link);
}

export function staffInvitationMail(input: {
  readonly displayName: string;
  readonly link: string;
  readonly expiresAt: Date;
}): MailContent {
  const until = input.expiresAt.toISOString();
  const en = [
    `Hello ${input.displayName},`,
    `You have been invited to join an ISP workspace on ${PRODUCT}. Open the link below to accept the invitation and set your password:`,
    input.link,
    `The invitation expires at ${until} (UTC). Ask your administrator for a new one after that.`,
  ];
  const ar = [
    `مرحباً ${input.displayName}،`,
    `تمت دعوتك للانضمام إلى مساحة عمل مزوّد إنترنت على ${PRODUCT}. افتح الرابط أدناه لقبول الدعوة وتعيين كلمة المرور:`,
    input.link,
    `تنتهي صلاحية الدعوة في ${until} (بالتوقيت العالمي). اطلب دعوة جديدة من مدير النظام بعد ذلك.`,
  ];
  return compose(`${PRODUCT} staff invitation · دعوة موظف`, en, ar, input.link);
}

export function integrationTestMail(input: {
  readonly scope: 'platform' | 'tenant';
  readonly requestedBy: string;
  readonly occurredAt: Date;
}): MailContent {
  const scope = input.scope === 'platform' ? 'Control Center' : 'ISP workspace';
  const scopeAr = input.scope === 'platform' ? 'مركز التحكم' : 'مساحة عمل مزوّد الإنترنت';
  const stamp = input.occurredAt.toISOString();
  const en = [
    `This is a test message from the ${PRODUCT} ${scope}.`,
    `Requested by ${input.requestedBy} at ${stamp} (UTC). Receiving it confirms the SMTP settings work.`,
  ];
  const ar = [
    `هذه رسالة اختبار من ${scopeAr} في ${PRODUCT}.`,
    `طلبها ${input.requestedBy} في ${stamp} (بالتوقيت العالمي). استلامها يؤكد أن إعدادات البريد تعمل.`,
  ];
  return compose(`${PRODUCT} SMTP test · اختبار البريد`, en, ar);
}

export function integrationTestText(input: {
  readonly scope: 'platform' | 'tenant';
  readonly occurredAt: Date;
}): string {
  const stamp = input.occurredAt.toISOString().slice(0, 16).replace('T', ' ');
  return `${PRODUCT} test message (${input.scope}) ${stamp} UTC. Receiving it confirms the provider settings. / رسالة اختبار من ${PRODUCT}؛ استلامها يؤكد أن إعدادات المزوّد تعمل.`;
}

function compose(
  subject: string,
  english: readonly string[],
  arabic: readonly string[],
  highlight?: string,
): MailContent {
  const text = [...english, '', '----', '', ...arabic].join('\n');
  const paragraph = (line: string) =>
    `<p style="margin:0 0 12px;font:15px/1.6 system-ui,sans-serif">${line === highlight ? `<strong dir="ltr" style="font-size:20px;letter-spacing:2px">${escape(line)}</strong>` : escape(line)}</p>`;
  const html = [
    '<div style="max-width:560px;margin:0 auto;padding:24px;color:#14213d">',
    `<h1 style="font:600 18px/1.4 system-ui,sans-serif;margin:0 0 16px">${escape(PRODUCT)}</h1>`,
    '<div lang="en" dir="ltr">',
    ...english.map(paragraph),
    '</div>',
    '<hr style="border:0;border-top:1px solid #d9dee8;margin:20px 0" />',
    '<div lang="ar" dir="rtl" style="text-align:right">',
    ...arabic.map(paragraph),
    '</div>',
    '</div>',
  ].join('');
  return { subject, text, html };
}

function escape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}
