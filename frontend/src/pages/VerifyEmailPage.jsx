import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/useAuthStore";
import { Mail, ArrowRight, RefreshCw, CheckCircle2 } from "lucide-react";
import toast from "react-hot-toast";
import usePageMeta from "../hooks/usePageMeta";

export default function VerifyEmailPage() {
  usePageMeta("Verify Your Email — AlphaSync", "Please verify your email address to start trading.");

  const location = useLocation();
  const navigate = useNavigate();
  const resendVerification = useAuthStore((s) => s.resendVerification);
  const loginWithEmail = useAuthStore((s) => s.loginWithEmail);

  const email = location.state?.email || "";
  const password = location.state?.password || "";

  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [checking, setChecking] = useState(false);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const handleResend = async () => {
    if (!email || !password) {
      toast.error("Session expired. Please register again.");
      navigate("/register");
      return;
    }
    setResending(true);
    try {
      const result = await resendVerification(email, password);
      if (result.alreadyVerified) {
        toast.success("Email already verified! Signing you in...");
        await loginWithEmail(email, password);
        navigate("/select-mode");
        return;
      }
      toast.success("Verification email sent! Check your inbox.");
      setCooldown(60);
    } catch (err) {
      toast.error(err.message || "Failed to resend. Try again.");
    } finally {
      setResending(false);
    }
  };

  const handleCheckVerification = async () => {
    if (!email || !password) {
      toast.error("Session expired. Please sign in.");
      navigate("/login");
      return;
    }
    setChecking(true);
    try {
      await loginWithEmail(email, password);
      toast.success("Email verified! Welcome to AlphaSync.");
      navigate("/select-mode");
    } catch (err) {
      if (err.code === "auth/email-not-verified") {
        toast.error("Email not verified yet. Please check your inbox and click the verification link.");
      } else {
        toast.error(err.message || "Verification check failed.");
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          {/* Icon */}
          <div className="mx-auto w-16 h-16 rounded-full bg-[#0EA5E9]/10 flex items-center justify-center mb-6">
            <Mail className="w-8 h-8 text-[#0EA5E9]" />
          </div>

          <h1 className="text-2xl font-bold text-slate-900 mb-2">Verify your email</h1>
          <p className="text-sm text-slate-500 mb-1">We've sent a verification link to</p>
          <p className="text-sm font-semibold text-slate-800 mb-6">{email || "your email address"}</p>

          {/* Steps */}
          <div className="text-left bg-slate-50 rounded-xl p-4 mb-6 space-y-3">
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-[#0EA5E9] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">1</span>
              <p className="text-sm text-slate-600">Open your email inbox (check spam/promotions too)</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-[#0EA5E9] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">2</span>
              <p className="text-sm text-slate-600">Click the verification link from AlphaSync</p>
            </div>
            <div className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-[#0EA5E9] text-white text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">3</span>
              <p className="text-sm text-slate-600">Come back here and click "I've verified my email"</p>
            </div>
          </div>

          {/* Primary action */}
          <button
            onClick={handleCheckVerification}
            disabled={checking}
            className="w-full py-3 px-4 rounded-xl bg-[#0EA5E9] hover:bg-[#0284C7] text-white font-semibold text-sm transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 mb-3"
          >
            {checking ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {checking ? "Checking..." : "I've verified my email"}
          </button>

          {/* Resend */}
          <button
            onClick={handleResend}
            disabled={resending || cooldown > 0}
            className="w-full py-2.5 px-4 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 font-medium text-sm transition-all duration-200 flex items-center justify-center gap-2 disabled:opacity-50 mb-4"
          >
            {resending ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Mail className="w-4 h-4" />
            )}
            {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? "Sending..." : "Resend verification email"}
          </button>

          {/* Divider */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex-1 h-px bg-slate-200" />
            <span className="text-[10px] text-slate-400 uppercase tracking-widest">or</span>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {/* Links */}
          <div className="flex items-center justify-center gap-4 text-sm">
            <Link to="/login" className="text-[#0EA5E9] hover:underline font-medium flex items-center gap-1">
              Sign In <ArrowRight className="w-3 h-3" />
            </Link>
            <span className="text-slate-300">|</span>
            <Link to="/register" className="text-slate-500 hover:text-slate-700 font-medium">
              Register again
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500 mt-6">
          Didn't receive the email? Check your spam folder or try a different email address.
        </p>
      </div>
    </div>
  );
}
