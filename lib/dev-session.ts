export const DEV_AUTH_COOKIE = "veil_dev_auth";
export const DEV_AUTH_COOKIE_VALUE = "default";

export const DEV_USER_PROFILE = {
  clerkId: "dev_default_user",
  email: "dev@unveil.local",
  displayName: "Dev User",
  imageUrl: null,
} as const;

export function isDevAuthEnabled() {
  return process.env.NODE_ENV === "development";
}

export function isValidDevAuthCookie(value: string | undefined) {
  return isDevAuthEnabled() && value === DEV_AUTH_COOKIE_VALUE;
}

export function devAuthCookieOptions() {
  return {
    httpOnly: false,
    sameSite: "lax" as const,
    secure: false,
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  };
}
