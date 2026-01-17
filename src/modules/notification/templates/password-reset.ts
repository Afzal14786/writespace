import { emailLayout } from "./layout";
import { IPasswordResetPayload } from "../interface/email.interface";

export const passwordResetTemplate = (data: IPasswordResetPayload) =>
  emailLayout(
    `
    <h2 style="color: #2d3748; margin-top: 0;">Reset Your Password 🔒</h2>
    <p>Hi ${data.username},</p>
    <p>We received a request to reset the password for your account.</p>
    <p>Please click the button below to restore access. This link is valid for <strong>1 hour</strong>.</p>
    
    <div style="text-align: center;">
        <a href="${data.resetLink}" class="btn">Reset Password</a>
    </div>

    <p style="font-size: 14px; color: #718096;">
        If you didn't ask for this, you can safely ignore this email. Your password won't change.
    </p>
    <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
    <p style="font-size: 13px; color: #a0aec0; word-break: break-all;">
        Or copy this link: <br>
        <a href="${data.resetLink}" class="link">${data.resetLink}</a>
    </p>
`,
    "Password Reset Request",
  );
