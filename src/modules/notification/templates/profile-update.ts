import { emailLayout } from "./layout";
import { IProfileUpdatePayload } from "../interface/email.interface";

export const profileUpdateTemplate = (data: IProfileUpdatePayload) =>
  emailLayout(
    `
    <h2 style="color: #2d3748; margin-top: 0;">Profile Updated</h2>
    <p>Hi ${data.username},</p>
    <p>Your profile information has been successfully updated.</p>
    
    <div style="text-align: center;">
        <a href="${data.profileLink}" class="btn">View Profile</a>
    </div>
    
    <p style="font-size: 14px; color: #718096;">
        If you didn't make these changes, please check your account security settings.
    </p>
`,
    "Profile Information Updated",
  );
