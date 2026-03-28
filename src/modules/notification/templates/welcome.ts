import { baseEmailLayout } from "./layout";

export const welcomeTemplate = (data: { username: string; ctaLink: string }) => {
  const content = `
    <div style="text-align: center;">
      <h2 style="color: #0f172a; margin-bottom: 16px;">Welcome to Writespace, ${data.username}!</h2>
      <p style="color: #334155; margin-bottom: 24px;">We're thrilled to have you on board. Start exploring, writing, and connecting with other developers today.</p>
      <a href="${data.ctaLink}" class="button">Complete Your Profile</a>
    </div>
  `;
  return baseEmailLayout(content, "Welcome to Writespace!");
};