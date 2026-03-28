import { baseEmailLayout } from "./layout";

export const passwordResetTemplate = (data: { username: string; resetLink: string }) => {
  const content = `
    <div>
      <h2 style="color: #0f172a; margin-bottom: 16px;">Password Reset Request</h2>
      <p>Hi ${data.username},</p>
      <p>We received a request to reset the password for your Writespace account. If you made this request, click the button below to set a new password.</p>
      <br/>
      <a href="${data.resetLink}" class="button">Reset Password</a>
      <p style="margin-top: 32px; font-size: 14px; color: #64748b;">If you didn't request a password reset, you can safely ignore this email.</p>
    </div>
  `;
  return baseEmailLayout(content, "Reset Your Password - Writespace");
};