// The email of a team invitation, in Verifire's look: black header with the logo, the company, who invites and with
// which role, and one red button. Built with tables and inline styles, the only layout every mail client agrees on.
// Every value that comes from a user is escaped: a company name must not be able to inject markup into someone's inbox.
import type { Locale } from '../locale';
import type { TeamRole } from '../types';

interface InvitationEmail {
  companyName: string;
  inviterName: string;
  role: TeamRole;
  link: string;
  minutes: number;
  baseUrl: string;
  locale: Locale;
}

const copy = {
  es: {
    subject: (company: string) => `${company} te invita a su equipo en Verifire`,
    preheader: (inviter: string, company: string, minutes: number) => `${inviter} te sumó a ${company}. La invitación vence en ${minutes} minutos.`,
    eyebrow: 'Invitación a un equipo',
    heading: (company: string) => `Te invitaron a ${company}`,
    lead: (inviter: string, company: string) =>
      `${inviter} te invita a sumarte al equipo de ${company} en Verifire, la plataforma de verificación de productos y garantías certificadas.`,
    company: 'Empresa',
    role: 'Rol',
    from: 'Invita',
    button: 'Aceptar invitación',
    expires: (minutes: number) => `Por seguridad, esta invitación vence en ${minutes} minutos y sirve una sola vez.`,
    fallback: 'Si el botón no funciona, copiá este enlace en tu navegador:',
    ignore: 'Si no esperabas esta invitación, podés ignorar este correo: nadie va a acceder a tu cuenta.',
    footer: 'Verifire · Verificación de productos y garantías certificadas en Solana',
    roles: { admin: 'Administrador', operator: 'Operador', auditor: 'Auditor', viewer: 'Solo lectura' }
  },
  en: {
    subject: (company: string) => `${company} invites you to its team on Verifire`,
    preheader: (inviter: string, company: string, minutes: number) => `${inviter} added you to ${company}. The invitation expires in ${minutes} minutes.`,
    eyebrow: 'Team invitation',
    heading: (company: string) => `You were invited to ${company}`,
    lead: (inviter: string, company: string) =>
      `${inviter} invites you to join the ${company} team on Verifire, the platform for product verification and certified warranties.`,
    company: 'Company',
    role: 'Role',
    from: 'Invited by',
    button: 'Accept invitation',
    expires: (minutes: number) => `For your security, this invitation expires in ${minutes} minutes and works only once.`,
    fallback: 'If the button does not work, paste this link into your browser:',
    ignore: 'If you were not expecting this invitation, you can ignore this email: nobody will access your account.',
    footer: 'Verifire · Product verification and certified warranties on Solana',
    roles: { admin: 'Administrator', operator: 'Operator', auditor: 'Auditor', viewer: 'Read only' }
  }
} satisfies Record<Locale, unknown>;

const escape = (value: string) =>
  value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase() || 'VF';

export const invitationEmail = ({ companyName, inviterName, role, link, minutes, baseUrl, locale }: InvitationEmail) => {
  const t = copy[locale];
  const company = escape(companyName);
  const inviter = escape(inviterName);
  const roleLabel = t.roles[role];
  const href = escape(link);
  const logo = escape(`${baseUrl}/brand/verifire-light.png`);
  const font = "font-family:'Urbanist','Segoe UI',Helvetica,Arial,sans-serif;";
  const row = (label: string, value: string, last = false) =>
    `<tr><td style="${font}padding:14px 18px;${last ? '' : 'border-bottom:1px solid #ececec;'}color:#6b6b6b;font-size:14px;">${label}</td>` +
    `<td align="right" style="${font}padding:14px 18px;${last ? '' : 'border-bottom:1px solid #ececec;'}color:#111111;font-size:14px;font-weight:700;">${value}</td></tr>`;

  const html = `<!doctype html>
<html lang="${locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<title>${escape(t.subject(companyName))}</title>
</head>
<body style="margin:0;padding:0;background:#f2f2f2;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escape(t.preheader(inviterName, companyName, minutes))}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f2f2f2;">
<tr><td align="center" style="padding:32px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #e2e2e2;">
    <tr><td align="center" style="background:#0d0d0d;padding:28px 24px;">
      <img src="${logo}" width="150" alt="Verifire" style="display:block;width:150px;height:auto;border:0;">
    </td></tr>
    <tr><td style="height:4px;background:#e3261f;line-height:4px;font-size:0;">&nbsp;</td></tr>
    <tr><td align="center" style="padding:36px 32px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" width="64" height="64" style="${font}width:64px;height:64px;border-radius:18px;background:#fde6e4;color:#e3261f;font-size:22px;font-weight:900;">${escape(initials(companyName))}</td></tr></table>
      <p style="${font}margin:22px 0 6px;color:#6b6b6b;font-size:12px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;">${t.eyebrow}</p>
      <h1 style="${font}margin:0;color:#000000;font-size:26px;line-height:1.2;font-weight:800;">${escape(t.heading(companyName))}</h1>
      <p style="${font}margin:14px 0 0;color:#4a4a4a;font-size:15px;line-height:1.6;">${escape(t.lead(inviterName, companyName))}</p>
    </td></tr>
    <tr><td style="padding:24px 32px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececec;border-radius:12px;">
        ${row(t.company, company)}${row(t.role, escape(roleLabel))}${row(t.from, inviter, true)}
      </table>
    </td></tr>
    <tr><td align="center" style="padding:28px 32px 8px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" style="border-radius:12px;background:#e3261f;">
        <a href="${href}" style="${font}display:inline-block;padding:15px 34px;color:#ffffff;font-size:16px;font-weight:800;text-decoration:none;border-radius:12px;">${t.button}</a>
      </td></tr></table>
    </td></tr>
    <tr><td align="center" style="padding:10px 32px 0;">
      <p style="${font}margin:0;color:#9a5b00;font-size:13px;font-weight:700;">&#9201; ${escape(t.expires(minutes))}</p>
    </td></tr>
    <tr><td style="padding:26px 32px 0;">
      <p style="${font}margin:0 0 6px;color:#6b6b6b;font-size:12px;">${t.fallback}</p>
      <p style="margin:0;font-family:Consolas,Menlo,monospace;font-size:12px;word-break:break-all;"><a href="${href}" style="color:#e3261f;">${href}</a></p>
    </td></tr>
    <tr><td style="padding:24px 32px 32px;">
      <p style="${font}margin:0;padding-top:20px;border-top:1px solid #ececec;color:#8a8a8a;font-size:12px;line-height:1.6;">${t.ignore}</p>
    </td></tr>
  </table>
  <p style="${font}margin:18px 0 0;color:#8a8a8a;font-size:12px;">${t.footer}</p>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    t.heading(companyName),
    '',
    t.lead(inviterName, companyName),
    '',
    `${t.company}: ${companyName}`,
    `${t.role}: ${roleLabel}`,
    `${t.from}: ${inviterName}`,
    '',
    `${t.button}: ${link}`,
    '',
    t.expires(minutes),
    '',
    t.ignore,
    '',
    t.footer
  ].join('\n');

  return { subject: t.subject(companyName), html, text };
};
