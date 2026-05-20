# Supabase Auth — Custom SMTP via Resend + Email Templates

This document is the once-off setup we do in Supabase Studio (Auth settings)
so that signup confirmation, magic link, password reset, and email change
emails come from `invites@taskora.deftai.in` via Resend, and match the bold
marketing-style design used by our workspace invite emails.

**Prerequisite:** the Resend sending domain `taskora.deftai.in` must be
**Verified** in https://resend.com/domains before SMTP works — Resend will
otherwise 403 the auth-email sends.

## Step 1 — Enable Custom SMTP

Supabase Studio → **Project Settings** → **Auth** → **SMTP Settings** → toggle
**Enable Custom SMTP**, then:

| field | value |
| --- | --- |
| Sender email | `invites@taskora.deftai.in` |
| Sender name  | `Taskora` |
| Host         | `smtp.resend.com` |
| Port         | `465` |
| Username     | `resend` |
| Password     | *(the Resend API key — same one set as `RESEND_API_KEY` on the backend Vercel project)* |
| Min interval | leave at default |

Save. Supabase will send a test email to the project's billing email
(`engineeradityasingh@gmail.com`) to validate the config; the green tick
confirms SMTP is wired.

## Step 2 — Replace the 4 email templates

Supabase Studio → **Authentication** → **Email Templates**. There are four
templates; subject + body HTML for each below. Paste the HTML into the
"Message body (HTML)" field and the subject into the "Subject heading"
field. Save each before moving to the next.

> **Note on variables:** Supabase substitutes `{{ .ConfirmationURL }}`,
> `{{ .Email }}`, `{{ .Token }}`, `{{ .NewEmail }}`, etc. at send time.
> Don't HTML-escape them — Supabase already produces safe values.

### Template 1 · Confirm signup

**Subject:** `Confirm your email on Taskora`

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Taskora</title></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1A1A2E">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px;mso-hide:all">Confirm your email to start using Taskora — one tap.</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F3F4F6"><tr><td align="center" style="padding:32px 16px">
    <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(16,24,40,0.04),0 4px 12px rgba(16,24,40,0.06)">
      <tr><td style="background:#1A1A2E;background-image:linear-gradient(135deg,#1A1A2E 0%,#0F3460 100%);padding:40px 32px 36px;color:#FFFFFF">
        <div style="font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:600;color:#9CA3AF">Taskora</div>
        <div style="font-size:12px;color:#C7D2FE;margin-top:18px;letter-spacing:0.5px;text-transform:uppercase;font-weight:600">Welcome aboard</div>
        <h1 style="margin:8px 0 0;font-size:30px;line-height:1.2;font-weight:700">Confirm your email</h1>
      </td></tr>
      <tr><td style="padding:32px">
        <p style="margin:0 0 24px;font-size:15px;line-height:1.7;color:#1A1A2E">Hi! You signed up to <strong>Taskora</strong> as <strong>{{ .Email }}</strong>. Tap the button below to confirm this address and we'll take you to your workspace.</p>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;background:#F3F4F6;border-radius:12px;padding:8px 16px">
          <tr><td style="padding:8px 8px 4px;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;font-weight:600;color:#6B7280">Once you're in, you can</td></tr>
          <tr><td style="padding:0 8px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="padding:6px 0;vertical-align:top;font-size:16px;line-height:1.5;width:28px">📋</td><td style="padding:6px 0;color:#1A1A2E;font-size:15px;line-height:1.6">Track tasks across initiatives and programs</td></tr>
            <tr><td style="padding:6px 0;vertical-align:top;font-size:16px;line-height:1.5;width:28px">✅</td><td style="padding:6px 0;color:#1A1A2E;font-size:15px;line-height:1.6">Approve work in one click — no email chains</td></tr>
            <tr><td style="padding:6px 0;vertical-align:top;font-size:16px;line-height:1.5;width:28px">⏰</td><td style="padding:6px 0;color:#1A1A2E;font-size:15px;line-height:1.6">See what's overdue at a glance</td></tr>
          </table></td></tr>
        </table>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr><td align="center" bgcolor="#0F3460" style="border-radius:10px">
          <a href="{{ .ConfirmationURL }}" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:600;color:#FFFFFF;text-decoration:none;border-radius:10px;background:#0F3460">Confirm my email →</a>
        </td></tr></table>
        <p style="margin:24px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#6B7280">Or paste this link into your browser:<br><a href="{{ .ConfirmationURL }}" style="color:#0F3460;text-decoration:none;word-break:break-all">{{ .ConfirmationURL }}</a></p>
      </td></tr>
      <tr><td style="border-top:1px solid #E5E7EB;padding:20px 32px;text-align:center;color:#6B7280;font-size:11px;line-height:1.6">
        <div style="font-weight:600;color:#1A1A2E;letter-spacing:0.5px">TASKORA · Work that ships.</div>
        <div style="margin-top:4px">If you didn't sign up for Taskora, you can safely ignore this email.</div>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>
```

### Template 2 · Magic Link

**Subject:** `Your Taskora sign-in link`

Same shell as Template 1 — only the hero copy, intro, and CTA label change.
Hero eyebrow: `Sign in` · Hero title: `Your magic link`. Intro:
`Tap the button below to sign in to Taskora. This link is good for the next 60 minutes and can only be used once.`
CTA label: `Sign in to Taskora →`. CTA href: `{{ .ConfirmationURL }}`.
Footer line 2: `If you didn't request this sign-in link, you can safely ignore this email.`

### Template 3 · Reset Password

**Subject:** `Reset your Taskora password`

Hero eyebrow: `Account` · Hero title: `Reset your password`. Intro:
`Tap below to choose a new password for {{ .Email }}. The link is good for the next 60 minutes.`
CTA label: `Reset my password →`. CTA href: `{{ .ConfirmationURL }}`.
Drop the "Once you're in, you can…" bullet block on this template — keep it
focused. Footer line 2: `If you didn't ask to reset your password, you can ignore this email — your password stays the same.`

### Template 4 · Email Change

**Subject:** `Confirm your new Taskora email`

Hero eyebrow: `Account` · Hero title: `Confirm your new email`. Intro:
`We received a request to change your Taskora email to <strong>{{ .NewEmail }}</strong>. Tap below to confirm this change.`
CTA label: `Confirm the change →`. CTA href: `{{ .ConfirmationURL }}`.
Drop the bullet block. Footer line 2: `If you didn't request this change, ignore this email and your account stays untouched.`

## Step 3 — Test

After saving SMTP + all 4 templates:

1. **Confirm signup** — sign up a throwaway user via the prod app; check the inbox.
2. **Reset password** — trigger Forgot Password from `/login`; check the inbox.
3. Validate the From address shows `Taskora <invites@taskora.deftai.in>`,
   not `noreply@mail.app.supabase.io`.

If any send fails with a 403 from Resend, the most likely cause is the
domain hasn't fully verified — check https://resend.com/domains.
