/**
 * Starter transactional email templates, in the Beleth house style. These are
 * the source of truth — the admin Templates tab provisions them into Resend
 * (create + publish) one click at a time, so nothing hits the shared Resend
 * account until someone asks for it.
 *
 * Email HTML rules: tables, inline styles, explicit colours everywhere (no CSS
 * variables, no flexbox, no external fonts). The palette mirrors globals.css.
 */

const C = {
  page: "#0b0e11",
  card: "#0f1317",
  headBand: "#141a20",
  border: "#1f262c",
  borderStrong: "#2a333a",
  txt: "#dde3e8",
  sec: "#8c959d",
  dim: "#5d666e",
  acc: "#d9a03c",
  onAcc: "#0b0e11",
  green: "#35a67c",
  red: "#e0584c",
};

const SANS =
  "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO =
  "'Roboto Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

// Absolute origin for images in email — clients need a hosted URL (no inline
// SVG, no data: URIs). Overridable while the custom domain isn't bound.
const SITE = (process.env.BELETH_SITE_URL || "https://beleth.davidemaiorana.dev").replace(
  /\/$/,
  "",
);
const LOGO_SRC = `${SITE}/beleth.png`;

export type TemplateVarSpec = {
  key: string;
  type: "string" | "number";
  fallback_value?: string | number;
};

export type StarterTemplate = {
  alias: string;
  name: string;
  subject: string;
  description: string;
  variables: TemplateVarSpec[];
  html: string;
};

type Block =
  | { p: string }
  | { cta: { label: string; url: string } }
  | { note: string; tone?: "default" | "warn" };

function renderBlocks(blocks: Block[]): string {
  return blocks
    .map((b) => {
      if ("p" in b) {
        return `<tr><td style="padding:0 0 16px 0;font-family:${SANS};font-size:15px;line-height:1.6;color:${C.txt};">${b.p}</td></tr>`;
      }
      if ("cta" in b) {
        return `<tr><td style="padding:8px 0 24px 0;">
          <a href="${b.cta.url}" style="display:inline-block;background-color:${C.acc};color:${C.onAcc};font-family:${MONO};font-size:13px;letter-spacing:0.06em;text-transform:uppercase;text-decoration:none;padding:12px 22px;border-radius:6px;font-weight:700;">${b.cta.label}</a>
        </td></tr>`;
      }
      const color = b.tone === "warn" ? C.red : C.dim;
      return `<tr><td style="padding:0 0 12px 0;font-family:${SANS};font-size:12.5px;line-height:1.6;color:${color};">${b.note}</td></tr>`;
    })
    .join("");
}

function shell(opts: {
  preheader: string;
  heading: string;
  blocks: Block[];
  // Marketing broadcasts need an unsubscribe link; transactional mail must not
  // have one. Resend fills {{{RESEND_UNSUBSCRIBE_URL}}} per recipient.
  unsubscribe?: boolean;
}): string {
  const unsubRow = opts.unsubscribe
    ? `<p style="margin:10px 0 0 0;font-family:${SANS};font-size:11.5px;line-height:1.6;color:${C.dim};">
              <a href="{{{RESEND_UNSUBSCRIBE_URL}}}" style="color:${C.dim};text-decoration:underline;">Unsubscribe</a> from these updates.
            </p>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${opts.heading}</title>
</head>
<body style="margin:0;padding:0;background-color:${C.page};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${opts.preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${C.page};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background-color:${C.card};border:1px solid ${C.border};border-radius:12px;overflow:hidden;">
        <tr>
          <td style="padding:18px 28px;background-color:${C.headBand};border-bottom:1px solid ${C.border};">
            <img src="${LOGO_SRC}" width="22" height="26" alt="Beleth" style="display:inline-block;vertical-align:middle;border:0;outline:none;">
            <span style="font-family:${MONO};font-size:13px;letter-spacing:0.18em;color:${C.txt};vertical-align:middle;margin-left:10px;">BELETH</span>
          </td>
        </tr>
        <tr>
          <td style="padding:28px 28px 4px 28px;">
            <h1 style="margin:0 0 18px 0;font-family:${SANS};font-size:19px;font-weight:600;color:${C.txt};">${opts.heading}</h1>
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
              ${renderBlocks(opts.blocks)}
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:18px 28px 24px 28px;border-top:1px solid ${C.border};">
            <p style="margin:0;font-family:${MONO};font-size:10.5px;letter-spacing:0.08em;text-transform:uppercase;color:${C.dim};">
              Beleth &middot; autonomous options-trading agent &middot; paper trading only
            </p>
            <p style="margin:6px 0 0 0;font-family:${SANS};font-size:11.5px;line-height:1.6;color:${C.dim};">
              This is an automated message from the Beleth dashboard. Not investment advice.
            </p>
            ${unsubRow}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}

export const STARTER_TEMPLATES: StarterTemplate[] = [
  {
    alias: "beleth-welcome",
    name: "Welcome",
    subject: "Welcome to Beleth",
    description: "Sent once, after a new account's email is confirmed.",
    variables: [
      { key: "name", type: "string", fallback_value: "there" },
      {
        key: "dashboard_url",
        type: "string",
        fallback_value: "https://beleth.davidemaiorana.dev/dashboard",
      },
    ],
    html: shell({
      preheader: "Your Beleth account is ready.",
      heading: "Welcome, {{{name}}}",
      blocks: [
        {
          p: "Your account is ready. Beleth is an autonomous agent that trades defined-risk options spreads on a paper account, and logs every decision — including the trades it decides <em>not</em> to take.",
        },
        {
          p: "The dashboard shows the live decision log, open positions, the strategy notes, and each risk-check result.",
        },
        { cta: { label: "Open the dashboard", url: "{{{dashboard_url}}}" } },
        {
          note: "You're receiving this because you signed up at beleth.davidemaiorana.dev.",
        },
      ],
    }),
  },
  {
    alias: "beleth-confirm-email",
    name: "Confirm email",
    subject: "Confirm your email",
    description: "Signup confirmation. Maps to Supabase Auth's confirmation mail.",
    variables: [
      { key: "confirmation_url", type: "string", fallback_value: "https://beleth.davidemaiorana.dev" },
    ],
    html: shell({
      preheader: "Confirm your email to finish signing up.",
      heading: "Confirm your email",
      blocks: [
        { p: "Tap the button below to confirm this address and activate your Beleth account." },
        { cta: { label: "Confirm email", url: "{{{confirmation_url}}}" } },
        {
          p: `If the button doesn't work, copy this link into your browser:<br><span style="font-family:${MONO};font-size:12px;color:${C.sec};word-break:break-all;">{{{confirmation_url}}}</span>`,
        },
        { note: "If you didn't create a Beleth account, you can ignore this email." },
      ],
    }),
  },
  {
    alias: "beleth-reset-password",
    name: "Reset password",
    subject: "Reset your password",
    description: "Password recovery. Maps to Supabase Auth's recovery mail.",
    variables: [
      { key: "reset_url", type: "string", fallback_value: "https://beleth.davidemaiorana.dev/login" },
    ],
    html: shell({
      preheader: "Reset your Beleth password.",
      heading: "Reset your password",
      blocks: [
        { p: "We got a request to reset the password on your Beleth account. Choose a new one here:" },
        { cta: { label: "Choose a new password", url: "{{{reset_url}}}" } },
        {
          p: `Link not working? Paste this into your browser:<br><span style="font-family:${MONO};font-size:12px;color:${C.sec};word-break:break-all;">{{{reset_url}}}</span>`,
        },
        {
          note: "This link expires shortly. If you didn't ask for a reset, ignore this email — your password stays the same.",
        },
      ],
    }),
  },
  {
    alias: "beleth-password-changed",
    name: "Password changed",
    subject: "Your Beleth password was changed",
    description: "Security notification sent after a successful password change.",
    variables: [
      { key: "name", type: "string", fallback_value: "there" },
      {
        key: "support_url",
        type: "string",
        fallback_value: "https://beleth.davidemaiorana.dev/login",
      },
    ],
    html: shell({
      preheader: "Your password was just changed.",
      heading: "Your password was changed",
      blocks: [
        { p: "Hi {{{name}}}, this is a confirmation that the password on your Beleth account was just changed." },
        {
          note: "If this was you, nothing else to do.",
        },
        {
          note: "If this <strong>wasn't</strong> you, reset your password immediately and review your account.",
          tone: "warn",
        },
        { cta: { label: "Review account", url: "{{{support_url}}}" } },
      ],
    }),
  },
];

export function getStarterTemplate(alias: string): StarterTemplate | undefined {
  return STARTER_TEMPLATES.find((t) => t.alias === alias);
}

/**
 * Starting HTML for a new marketing campaign — the same branded shell as the
 * transactional templates, with placeholder copy and an unsubscribe footer.
 * Uses Resend broadcast tokens ({{{FIRST_NAME|there}}}, {{{RESEND_UNSUBSCRIBE_URL}}}).
 */
export function campaignStarterHtml(): string {
  return shell({
    preheader: "News from Beleth.",
    heading: "Hi {{{FIRST_NAME|there}}}",
    blocks: [
      { p: "Write your update here — what changed, what to look at, why it matters." },
      { p: "Keep it short. One idea per paragraph reads best in an inbox." },
      {
        cta: {
          label: "Open the dashboard",
          url: `${SITE}/dashboard`,
        },
      },
      { note: "You're getting this because you have a Beleth account." },
    ],
    unsubscribe: true,
  });
}
