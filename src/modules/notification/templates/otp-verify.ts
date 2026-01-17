import { emailLayout } from "./layout";
import { IOtpPayload } from "../../auth/interface/auth.interface";

export const otpVerifyTemplate = (data: IOtpPayload) =>
  emailLayout(
    `
    <h2 style="color: #2d3748; margin-top: 0;">Verify Account</h2>
    <p>Hi,</p>
    <p>Use the One Time Password (OTP) below to verify your email address and complete registration.</p>
    
    <div style="text-align: center; margin: 30px 0;">
        <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #764ba2; background: #f4f6f8; padding: 10px 20px; border-radius: 8px;">
            ${data.otp}
        </span>
    </div>

    <p style="font-size: 14px; color: #718096; text-align: center;">
        This OTP is valid for <strong>10 minutes</strong>. Do not share it with anyone.
    </p>
`,
    "Verification Code",
  );
