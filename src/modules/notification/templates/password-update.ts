import { baseEmailLayout } from "./layout";

export const passwordUpdateTemplate = (data: { username: string; contactSupportLink: string }) => {
  const htmlContent = `
    <div>
      <h2 style="color: #0f172a; margin-bottom: 16px;">Password Updated</h2>
      <p>Hi ${data.username},</p>
      <p>The password for your Writespace account was successfully changed.</p>
      <p>If you did not make this change, please contact support immediately to secure your account.</p>
      <br/>
      <a href="${data.contactSupportLink}" class="button">Contact Support</a>
    </div>
  `;

  const textContent = `Password Updated\n\nHi ${data.username},\n\nThe password for your Writespace account was successfully changed.\n\nIf you did not make this change, please contact support immediately to secure your account:\n${data.contactSupportLink}`;

  return { html: baseEmailLayout(htmlContent, "Password Updated - Writespace"), text: textContent };
};