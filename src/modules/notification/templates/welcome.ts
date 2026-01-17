import { emailLayout } from "./layout";
import { IWelcomePayload } from "../interface/email.interface";

export const welcomeTemplate = (data: IWelcomePayload) =>
  emailLayout(
    `
    <h2 style="color: #2d3748; margin-top: 0;">Welcome to the Community, ${data.username}! 🎉</h2>
    <p>We are absolutely thrilled to have you here. Blogify is a platform built for sharing ideas that matter.</p>
    
    <p>Get started by setting up your profile or diving into stories from top authors.</p>
    
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
