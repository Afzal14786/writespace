import { baseEmailLayout } from "./layout";

export const loginAlertTemplate = (data: { username: string; time: string; ip: string; secureAccountLink: string }) => {
  const content = `
    <div>
      <h2 style="color: #0f172a; margin-bottom: 16px;">New Login Detected</h2>
      <p>Hi ${data.username},</p>
      <p>We noticed a recent login to your Writespace account with the following details:</p>
      <ul style="background: #f1f5f9; padding: 16px; border-radius: 8px; list-style: none; margin: 16px 0;">
        <li style="margin-bottom: 8px;"><strong>Time:</strong> ${data.time}</li>
        <li><strong>IP Address:</strong> ${data.ip}</li>
      </ul>
      <p>If this was you, no further action is needed.</p>
      <p>If you don't recognize this activity, please secure your account immediately.</p>
      <br/>
      <a href="${data.secureAccountLink}" class="button">Secure Account</a>
    </div>
  `;
  return baseEmailLayout(content, "New Login Alert - Writespace");
};