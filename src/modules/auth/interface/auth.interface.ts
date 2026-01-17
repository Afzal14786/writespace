export interface IJwtPayload {
  id: string;
  role: string;
}

export interface IOAuthProfile {
  provider: "google" | "github";
  providerId: string;
  email: string;
  displayName: string;
  firstName?: string;
  lastName?: string;
  picture?: string;
}

export interface IOtpPayload {
  email: string;
  otp: string;
}
