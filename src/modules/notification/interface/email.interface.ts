export interface IWelcomePayload {
  username: string;
  ctaLink: string;
}

export interface IPasswordResetPayload {
  username: string;
  resetLink: string;
  expiryTime?: string; // e.g., "1 hour"
}

export interface ILoginAlertPayload {
  username: string;
  time: string;
  ip: string;
  device?: string; // Optional: "Chrome on macOS"
  secureAccountLink: string;
}

export interface IPasswordUpdatePayload {
  username: string;
  contactSupportLink: string;
}

export interface IProfileUpdatePayload {
  username: string;
  profileLink: string;
}

export interface IEmailJob {
  to: string;
  subject: string;
  html: string;
}
