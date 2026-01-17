import { emailLayout } from "./layout";
import { ILoginAlertPayload } from "../interface/email.interface";

export const loginAlertTemplate = (data: ILoginAlertPayload) =>
  emailLayout(
    `
    <h2 style="color: #2d3748; margin-top: 0;">New Login Detected ⚠️</h2>
    <p>Hi ${data.username},</p>
    <p>We noticed a new login to your account from a new device.</p>
    
    <div style="background-color: #fff5f5; border-left: 4px solid #fc8181; padding: 15px; margin: 20px 0; border-radius: 4px;">
        <p style="margin: 5px 0;"><strong>Time:</strong> ${data.time}</p>
        <p style="margin: 5px 0;"><strong>IP Address:</strong> ${data.ip}</p>
        ${data.device ? `<p style="margin: 5px 0;"><strong>Device:</strong> ${data.device}</p>` : ""}
    </div>

    <p>If this was you, you can ignore this email.</p>
    <p><strong>If you don't recognize this activity</strong>, please secure your account immediately.</p>

    <div style="text-align: center;">
        <a href="${data.secureAccountLink}" class="btn" style="background-color: #e53e3e; box-shadow: 0 4px 6px rgba(229, 62, 62, 0.2);">Secure My Account</a>
    </div>
`,
    "Security Alert: New Login",
  );
