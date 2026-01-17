import { emailLayout } from "./layout";
import { IPasswordUpdatePayload } from "../interface/email.interface";

export const passwordUpdateTemplate = (data: IPasswordUpdatePayload) =>
  emailLayout(
    `
    <h2 style="color: #2d3748; margin-top: 0;">Password Changed</h2>
    <p>Hi ${data.username},</p>
    <p>This email is to confirm that your password was successfully changed.</p>
    <p>If you did not authorized this action, please contact our support team immediately to lock your account.</p>

    <div style="text-align: center;">
        <a href="${data.contactSupportLink}" class="btn">Contact Support</a>
    </div>
`,
    "Your password has been changed",
  );
