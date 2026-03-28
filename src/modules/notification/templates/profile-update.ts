import { baseEmailLayout } from "./layout";

export const profileUpdateTemplate = (data: { username: string; profileLink: string }) => {
  const htmlContent = `
    <div>
      <h2 style="color: #0f172a; margin-bottom: 16px;">Profile Information Updated</h2>
      <p>Hi ${data.username},</p>
      <p>This is a quick notification to let you know that the core identity information on your Writespace profile has been updated.</p>
      <br/>
      <a href="${data.profileLink}" class="button">View Profile</a>
    </div>
  `;

  const textContent = `Profile Information Updated\n\nHi ${data.username},\n\nThis is a quick notification to let you know that the core identity information on your Writespace profile has been updated.\n\nView Profile: ${data.profileLink}`;

  return { html: baseEmailLayout(htmlContent, "Profile Updated - Writespace"), text: textContent };
};