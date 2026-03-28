import { baseEmailLayout } from "./layout";

export const otpVerifyTemplate = (data: { email: string; otp: string }) => {
  const content = `
    <div style="text-align: center;">
      <h2 style="color: #0f172a; margin-bottom: 16px;">Verify Your Email</h2>
      <p style="margin-bottom: 24px;">Please use the verification code below to confirm your Writespace account: <br/><strong>${data.email}</strong></p>
      <div style="background-color: #f8fafc; border: 2px dashed #cbd5e1; border-radius: 8px; padding: 16px; margin: 24px auto; max-width: 200px;">
        <span style="font-size: 32px; font-weight: 800; letter-spacing: 8px; color: #6366f1;">${data.otp}</span>
      </div>
      <p style="font-size: 14px; color: #64748b; margin-top: 24px;">This code expires in 10 minutes.</p>
    </div>
  `;
  return baseEmailLayout(content, "Verify Your Writespace Account");
};