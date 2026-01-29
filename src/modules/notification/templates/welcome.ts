import { emailLayout } from "./layout";
import { IWelcomePayload } from "../interface/email.interface";

export const welcomeTemplate = (data: IWelcomePayload) =>
  emailLayout(
    `
    <h2 style="color: #2d3748; margin-top: 0;">Welcome to the Community, ${data.username}! 🎉</h2>
        <p>Welcome to <strong>Writespace</strong>! 🚀</p>
        <p>We're thrilled to have you join our community of writers and readers.</p>
        <p>Start exploring, sharing your stories, and connecting with like-minded individuals.</p>
    
    <div style="text-align: center;">
        <a href="${data.ctaLink}" class="btn">Start Exploring</a>
    </div>

    <p style="font-size: 14px; color: #718096; margin-top: 20px;">
        If the button above doesn't work, verify your email by clicking here: 
        <a href="${data.ctaLink}" class="link">${data.ctaLink}</a>
    </p>
`,
    "Welcome to Blogify",
  );
