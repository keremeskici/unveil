"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSignIn, useSignUp } from "@clerk/nextjs/legacy";
import { Eye, EyeOff, Lock } from "lucide-react";
import { isDevAuthEnabled } from "@/lib/dev-session";
import { notifyDevAuthChanged, useAppAuth } from "./useAppAuth";
import { CurtainMark } from "./Wordmark";

type AuthMode = "sign-in" | "sign-up";
type OAuthStrategy = "oauth_google" | "oauth_x";
type SignInStep = "credentials" | "client-trust";
type SignUpStep = "credentials" | "verification";
type EmailCodeSecondFactor = {
  strategy: string;
  emailAddressId?: string;
};
type ClientTrustSignInResult = {
  supportedSecondFactors?: EmailCodeSecondFactor[] | null;
};
type SignInWithSecondFactor = {
  prepareSecondFactor: (params: {
    strategy: "email_code";
    emailAddressId?: string;
  }) => Promise<unknown>;
};

const OAUTH_STATE_KEY_PREFIXES = ["__clerk_oauth", "clerk_oauth", "oauth"];
const OAUTH_STATE_KEY_PARTS = ["oauth", "sso", "redirect"];

function errorMessage(err: unknown) {
  const clerkError = err as { errors?: { longMessage?: string; message?: string }[] };
  return (
    clerkError.errors?.[0]?.longMessage ??
    clerkError.errors?.[0]?.message ??
    (err instanceof Error ? err.message : "Authentication failed")
  );
}

// A social-only account (created via Google/X) has no password credential, so
// Clerk rejects password sign-in with `strategy_for_user_invalid` ("The
// verification strategy is not valid for this account"). Point the user at the
// social buttons instead of surfacing the raw API message.
function oauthOnlyAccountMessage(err: unknown): string | null {
  const clerkError = err as {
    errors?: { code?: string; message?: string; longMessage?: string }[];
  };
  const first = clerkError.errors?.[0];
  const text = `${first?.longMessage ?? ""} ${first?.message ?? ""}`;
  if (
    first?.code === "strategy_for_user_invalid" ||
    /verification strategy is not valid/i.test(text)
  ) {
    return 'This account was created with a social login. Use "Sign in with Google" or "Sign in with X" below.';
  }
  return null;
}

function signInStatusMessage(status: string | null) {
  switch (status) {
    case "needs_second_factor":
      return "This Clerk account is asking for a second factor. Turn off MFA in Clerk for password-only login.";
    case "needs_new_password":
      return "This account needs a new password before it can log in.";
    case "needs_client_trust":
      return "This browser needs email verification before completing sign-in.";
    case "needs_first_factor":
      return "Password sign-in is not enabled for this account.";
    default:
      return "Sign-in could not be completed. Please try again.";
  }
}

function clearStaleOAuthState() {
  if (typeof window === "undefined") return;

  for (const storage of [window.sessionStorage, window.localStorage]) {
    for (let i = storage.length - 1; i >= 0; i -= 1) {
      const key = storage.key(i);
      if (!key) continue;
      const normalized = key.toLowerCase();
      const isKnownOAuthKey = OAUTH_STATE_KEY_PREFIXES.some((prefix) =>
        normalized.startsWith(prefix),
      );
      const isClerkOAuthKey =
        normalized.includes("clerk") &&
        OAUTH_STATE_KEY_PARTS.some((part) => normalized.includes(part));

      if (isKnownOAuthKey || isClerkOAuthKey) {
        storage.removeItem(key);
      }
    }
  }
}

export function Onboarding() {
  const router = useRouter();
  const { isSignedIn } = useAppAuth();
  const signInState = useSignIn();
  const signUpState = useSignUp();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [signInStep, setSignInStep] = useState<SignInStep>("credentials");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [signUpStep, setSignUpStep] = useState<SignUpStep>("credentials");
  const [showPw, setShowPw] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [isDevPending, setIsDevPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isVerifyingClientTrust = mode === "sign-in" && signInStep === "client-trust";
  const isVerifyingSignUp = mode === "sign-up" && signUpStep === "verification";
  const canSubmit = isVerifyingSignUp || isVerifyingClientTrust
    ? verificationCode.trim() !== "" && !isPending
    : email.trim() !== "" && password !== "" && !isPending;

  useEffect(() => {
    if (isSignedIn) router.replace("/");
  }, [isSignedIn, router]);

  useEffect(() => {
    const oauthError = new URLSearchParams(window.location.search).get("oauth_error");
    if (!oauthError) return;

    setIsPending(false);
    setError(oauthError);
    router.replace("/sign-in", { scroll: false });
  }, [router]);

  if (isSignedIn) return null;

  async function completeWithSession(sessionId: string | null) {
    if (!sessionId || !signInState.isLoaded || !signUpState.isLoaded) {
      throw new Error("Sign-in needs another verification step.");
    }
    const setActive = mode === "sign-in" ? signInState.setActive : signUpState.setActive;
    await setActive({ session: sessionId });
    router.replace("/");
    router.refresh();
  }

  async function prepareClientTrustEmailVerification(
    signIn: SignInWithSecondFactor,
    result: ClientTrustSignInResult,
  ) {
    const emailCodeFactor = result.supportedSecondFactors?.find(
      (factor) => factor.strategy === "email_code",
    );

    if (!emailCodeFactor) {
      throw new Error("This browser needs verification, but email code sign-in is not enabled in Clerk.");
    }

    await signIn.prepareSecondFactor({
      strategy: "email_code",
      emailAddressId:
        "emailAddressId" in emailCodeFactor ? emailCodeFactor.emailAddressId : undefined,
    });
    setSignInStep("client-trust");
    setVerificationCode("");
  }

  async function submitEmailPassword() {
    if (!canSubmit || !signInState.isLoaded || !signUpState.isLoaded) return;
    setIsPending(true);
    setError(null);
    try {
      if (mode === "sign-in") {
        let result = await signInState.signIn.create({
          strategy: "password",
          identifier: email.trim(),
          password,
        });

        if (result.status === "needs_first_factor") {
          result = await signInState.signIn.attemptFirstFactor({
            strategy: "password",
            password,
          });
        }

        if (result.status !== "complete") {
          if (result.status === "needs_client_trust") {
            await prepareClientTrustEmailVerification(signInState.signIn, result);
            return;
          }

          throw new Error(signInStatusMessage(result.status));
        }

        await completeWithSession(result.createdSessionId);
      } else {
        const result = await signUpState.signUp.create({
          emailAddress: email.trim(),
          password,
        });
        if (result.status === "complete") {
          await completeWithSession(result.createdSessionId);
        } else {
          await signUpState.signUp.prepareEmailAddressVerification({
            strategy: "email_code",
          });
          setSignUpStep("verification");
          setVerificationCode("");
        }
      }
    } catch (err) {
      setError(
        (mode === "sign-in" ? oauthOnlyAccountMessage(err) : null) ?? errorMessage(err),
      );
    } finally {
      setIsPending(false);
    }
  }

  async function submitClientTrustCode() {
    if (!canSubmit || !signInState.isLoaded) return;
    setIsPending(true);
    setError(null);
    try {
      const result = await signInState.signIn.attemptSecondFactor({
        strategy: "email_code",
        code: verificationCode.trim(),
      });
      if (result.status !== "complete") {
        throw new Error(signInStatusMessage(result.status));
      }
      await signInState.setActive({ session: result.createdSessionId });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsPending(false);
    }
  }

  async function submitVerificationCode() {
    if (!canSubmit || !signUpState.isLoaded) return;
    setIsPending(true);
    setError(null);
    try {
      const result = await signUpState.signUp.attemptEmailAddressVerification({
        code: verificationCode.trim(),
      });
      if (result.status !== "complete") {
        throw new Error("Email verification needs another step.");
      }
      await signUpState.setActive({ session: result.createdSessionId });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setIsPending(false);
    }
  }

  async function startOAuth(strategy: OAuthStrategy) {
    if (!signInState.isLoaded || !signUpState.isLoaded) return;
    setIsPending(true);
    setError(null);
    try {
      signInState.signIn.__internal_future.reset();
      signUpState.signUp.__internal_future.reset();
      clearStaleOAuthState();

      const redirectUrl = new URL(
        `/sso-callback?strategy=${encodeURIComponent(strategy)}`,
        window.location.origin,
      ).toString();
      const redirectUrlComplete = new URL("/", window.location.origin).toString();

      await signInState.signIn.authenticateWithRedirect({
        strategy,
        redirectUrl,
        redirectUrlComplete,
      });
    } catch (err) {
      setError(errorMessage(err));
      setIsPending(false);
    }
  }

  async function startPasskey() {
    if (!signInState.isLoaded) return;
    setIsPending(true);
    setError(null);
    try {
      const result = await signInState.signIn.authenticateWithPasskey({
        flow: "discoverable",
      });
      if (result.status !== "complete" || !result.createdSessionId) {
        throw new Error("Passkey sign-in needs another verification step.");
      }
      await signInState.setActive({ session: result.createdSessionId });
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      setIsPending(false);
    }
  }

  async function startDevLogin() {
    setIsDevPending(true);
    setError(null);
    try {
      const res = await fetch("/api/dev/login", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Dev login failed");
      }
      notifyDevAuthChanged();
      router.replace("/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Dev login failed");
      setIsDevPending(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 overflow-hidden"
      style={{
        background:
          "radial-gradient(120% 60% at 50% -8%, rgba(194,20,59,.18), transparent 60%), var(--bg)",
      }}
    >
      <div
        className="mx-auto flex h-full w-full max-w-md flex-col px-7"
        style={{
          paddingTop: "max(28px, calc(env(safe-area-inset-top, 0px) + 14px))",
          paddingBottom: "max(18px, env(safe-area-inset-bottom, 0px))",
        }}
      >
        <div className="mb-5 flex items-center justify-center gap-[11px]">
          <CurtainMark
            width={48}
            height={48}
            radius={12}
            glow="0 0 24px rgba(255,20,40,.44)"
          />
          <span
            className="font-bold"
            style={{ fontSize: 25, letterSpacing: 0 }}
          >
            UNVEIL
          </span>
        </div>

        <div className="text-text mb-3 text-sm font-semibold">
          {isVerifyingClientTrust
            ? "Verify email"
            : mode === "sign-in"
            ? "Log in"
            : signUpStep === "verification"
              ? "Verify email"
              : "Create account"}
        </div>

        {isVerifyingSignUp || isVerifyingClientTrust ? (
          <input
            aria-label="Verification code"
            name="verification-code"
            value={verificationCode}
            onChange={(e) => setVerificationCode(e.target.value)}
            placeholder="Verification code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className="bg-surface-2 text-text placeholder:text-faint mb-4 h-[52px] w-full rounded-[14px] px-[18px] text-base outline-none focus:border-[color:var(--primary)]"
            style={{ border: "1px solid var(--hairline-2)" }}
          />
        ) : (
          <>
            <input
              aria-label="Email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              type="email"
              autoComplete="email"
              spellCheck={false}
              className="bg-surface-2 text-text placeholder:text-faint mb-3 h-[52px] w-full rounded-[14px] px-[18px] text-base outline-none focus:border-[color:var(--primary)]"
              style={{ border: "1px solid var(--hairline-2)" }}
            />

            <div className="relative mb-4">
              <input
                aria-label="Password"
                name="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                type={showPw ? "text" : "password"}
                autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
                className="bg-surface-2 text-text placeholder:text-faint h-[52px] w-full rounded-[14px] pl-[18px] pr-[52px] text-base outline-none focus:border-[color:var(--primary)]"
                style={{ border: "1px solid var(--hairline-2)" }}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                className="text-faint absolute right-0 top-0 flex h-[52px] w-[50px] items-center justify-center"
              >
                {showPw ? <EyeOff size={22} strokeWidth={1.9} /> : <Eye size={22} strokeWidth={1.9} />}
              </button>
            </div>
          </>
        )}

        <div id="clerk-captcha" className="mb-3" />

        <button
          type="button"
          onClick={
            isVerifyingClientTrust
              ? submitClientTrustCode
              : isVerifyingSignUp
                ? submitVerificationCode
                : submitEmailPassword
          }
          disabled={!canSubmit}
          className="h-[52px] w-full rounded-pill text-[15px] font-bold transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.985]"
          style={
            canSubmit
              ? { background: "var(--primary)", color: "#fff", boxShadow: "0 8px 28px var(--glow)" }
              : { background: "var(--surface-3)", color: "var(--faint)" }
          }
        >
          {isPending
            ? "OPENING..."
            : mode === "sign-in"
              ? isVerifyingClientTrust
                ? "VERIFY EMAIL"
                : "LOG IN"
              : isVerifyingSignUp
                ? "VERIFY EMAIL"
                : "SIGN UP"}
        </button>

        <p className="text-faint mt-3.5 text-[12.5px] leading-[1.55]">
          By logging in and using Unveil, you agree to our{" "}
          <span className="text-primary">Terms of Service</span> and{" "}
          <span className="text-primary">Privacy Policy</span>, and confirm that you
          are at least 18 years old.
        </p>

        {error && <p className="text-danger mt-3 text-[13px]">{error}</p>}

        <div
          className="text-primary flex items-center justify-center gap-3 text-sm font-semibold"
          style={{ margin: "18px 0 14px" }}
        >
          <button type="button" className="hover:text-primary-hover">
            Forgot password?
          </button>
          <span className="text-faint">·</span>
          <button
            type="button"
            onClick={() => {
              setError(null);
              setSignInStep("credentials");
              setSignUpStep("credentials");
              setVerificationCode("");
              setMode((current) => (current === "sign-in" ? "sign-up" : "sign-in"));
            }}
            className="hover:text-primary-hover"
          >
            {mode === "sign-in" ? "Sign up for Unveil" : "Log in instead"}
          </button>
        </div>

        <div className="mt-auto flex flex-col gap-3">
          {isDevAuthEnabled() && (
            <button
              type="button"
              onClick={startDevLogin}
              disabled={isPending || isDevPending}
              className="text-primary-fg relative flex h-[42px] w-full items-center justify-center rounded-pill text-xs font-bold tracking-[0.08em] transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.985] disabled:opacity-60"
              style={{ background: "var(--success)", boxShadow: "0 5px 18px rgba(43,180,119,.24)" }}
            >
              {isDevPending ? "OPENING DEV ACCOUNT..." : "CONTINUE AS DEV USER"}
            </button>
          )}

          <button
            type="button"
            onClick={startPasskey}
            disabled={isPending}
            className="text-primary-fg relative flex h-[42px] w-full items-center justify-center rounded-pill text-xs font-bold tracking-[0.08em] transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.985] disabled:opacity-60"
            style={{ background: "var(--primary)", boxShadow: "0 5px 18px var(--glow)" }}
          >
            <Lock size={16} className="absolute left-[20px]" />
            SIGN IN WITH PASSKEY
          </button>

          <button
            type="button"
            onClick={() => startOAuth("oauth_x")}
            disabled={isPending}
            className="text-text relative flex h-[42px] w-full items-center justify-center rounded-pill text-xs font-bold tracking-[0.08em] transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.985] disabled:opacity-60"
            style={{ border: "1px solid var(--primary)", background: "transparent" }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              className="absolute left-[20px]"
              aria-hidden
            >
              <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
            </svg>
            SIGN IN WITH X
          </button>

          <button
            type="button"
            onClick={() => startOAuth("oauth_google")}
            disabled={isPending}
            className="text-text relative flex h-[42px] w-full items-center justify-center rounded-pill text-xs font-bold tracking-[0.08em] transition-transform duration-[140ms] ease-[var(--ease-veil)] active:scale-[0.985] disabled:opacity-60"
            style={{ border: "1px solid var(--primary)", background: "transparent" }}
          >
            <svg width="17" height="17" viewBox="0 0 24 24" className="absolute left-[20px]" aria-hidden>
              <path fill="#4285F4" d="M21.6 12.2c0-.6-.1-1.3-.2-1.9H12v3.6h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.2Z" />
              <path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 .9-3.4.9-2.6 0-4.8-1.7-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
              <path fill="#FBBC05" d="M6.4 13.9a6 6 0 0 1 0-3.8V7.5H3.1a10 10 0 0 0 0 9l3.3-2.6Z" />
              <path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.8-2.8A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.6 9.4 5.9 12 5.9Z" />
            </svg>
            SIGN IN WITH GOOGLE
          </button>
        </div>
      </div>
    </div>
  );
}
