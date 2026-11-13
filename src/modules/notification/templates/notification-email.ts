export interface NotificationEmailTemplateInput {
  recipientName: string;
  title: string;
  body: string;
}

export interface NotificationEmailTemplateResult {
  subject: string;
  html: string;
  text: string;
}

export const NOTIFICATION_EMAIL_TEMPLATE_VERSION = "notification-email-v1";

/**
 * Escape user-controlled or database-stored text before inserting it
 * into an HTML email template.
 */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };

    return entities[character] ?? character;
  });
}

/**
 * Build a basic notification email from a persisted inbox notification.
 *
 * This template intentionally does not render arbitrary presentationData
 * as HTML. Category-specific templates can be registered later without
 * changing the delivery worker.
 */
export function notificationEmailTemplate(
  input: NotificationEmailTemplateInput,
): NotificationEmailTemplateResult {
  const recipientName = input.recipientName.trim() || "there";
  const title = input.title.trim() || "You have a new notification";
  const body = input.body.trim();

  // Prevent newline characters from becoming part of the email subject.
  const subject = title.replace(/[\r\n]+/g, " ").slice(0, 160);

  const safeRecipientName = escapeHtml(recipientName);
  const safeTitle = escapeHtml(title);
  const safeBody = escapeHtml(body);

  const html = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:24px;background-color:#f5f5f5;font-family:Arial,Helvetica,sans-serif;color:#222;">
  <div style="max-width:560px;margin:0 auto;padding:32px;background-color:#ffffff;border-radius:8px;">
    <p style="margin:0 0 20px;color:#555;font-size:14px;">
      Hello ${safeRecipientName},
    </p>

    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.4;">
      ${safeTitle}
    </h1>

    <div style="font-size:15px;line-height:1.7;color:#444;white-space:pre-wrap;">
      ${safeBody}
    </div>

    <hr style="margin:28px 0;border:0;border-top:1px solid #eeeeee;">

    <p style="margin:0;color:#777;font-size:12px;line-height:1.6;">
      You received this email because of activity associated with your
      Writespace account.
    </p>
  </div>
</body>
</html>`.trim();

  const text = [
    `Hello ${recipientName},`,
    "",
    title,
    "",
    body,
    "",
    "---",
    "You received this email because of activity associated with your Writespace account.",
  ].join("\n");

  return {
    subject,
    html,
    text,
  };
}
