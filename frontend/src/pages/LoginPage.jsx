// LoginPage.jsx
import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuthStore } from "../stores/useAuthStore";
import { useMarketIndicesStore } from "../stores/useMarketIndicesStore";
import { Mail, Lock, Eye, EyeOff, ArrowRight, ShieldCheck, LayoutDashboard } from "lucide-react";
import toast from "react-hot-toast";
import usePageMeta from "../hooks/usePageMeta";
import AuthPanelLeft from "../components/layout/AuthPanelLeft";

/* ─── Animated Trading Visualization ─────────────────────────── */
function TradingAnimation() {
  const tickerItems = useMarketIndicesStore((s) => s.tickerItems);
  const startPublicPolling = useMarketIndicesStore((s) => s.startPublicPolling);
  const stopPolling = useMarketIndicesStore((s) => s.stopPolling);

  useEffect(() => {
    startPublicPolling(30_000);
    return () => stopPolling();
  }, [startPublicPolling, stopPolling]);

  // Derive NIFTY data from store
  const nifty = useMemo(() => {
    const n = tickerItems.find((t) => (t.name || '').includes('NIFTY 50'));
    if (n) return { price: n.price, change: n.change || 0, changePct: n.change_percent || 0 };
    return { price: 22397.20, change: 93.45, changePct: 0.42 };
  }, [tickerItems]);

  // Derive mini stock row from store
  const miniStocks = useMemo(() => {
    const map = [
      { match: 'Reliance', label: 'RELIANCE' },
      { match: 'TCS', label: 'TCS' },
      { match: 'HDFC Bank', label: 'HDFC' },
      { match: 'Infosys', label: 'INFY' },
    ];
    return map.map((m) => {
      const t = tickerItems.find((x) => (x.name || '').includes(m.match));
      if (t) {
        const up = (t.change_percent || 0) >= 0;
        return { s: m.label, p: Math.round(t.price).toLocaleString('en-IN'), c: `${up ? '+' : ''}${(t.change_percent || 0).toFixed(2)}%`, up };
      }
      return null;
    }).filter(Boolean);
  }, [tickerItems]);

  const stockRow = miniStocks.length >= 4 ? miniStocks : [
    { s: 'RELIANCE', p: '1,219', c: '-0.52%', up: false },
    { s: 'TCS', p: '2,492', c: '+2.44%', up: true },
    { s: 'HDFC', p: '848', c: '+0.83%', up: true },
    { s: 'INFY', p: '1,517', c: '-1.85%', up: false },
  ];

  const candles = [
    { x: 28, o: 158, c: 132, h: 120, l: 172, up: true },
    { x: 58, o: 132, c: 150, h: 118, l: 163, up: false },
    { x: 88, o: 150, c: 124, h: 108, l: 164, up: true },
    { x: 118, o: 124, c: 142, h: 105, l: 155, up: false },
    { x: 148, o: 142, c: 112, h: 98, l: 155, up: true },
    { x: 178, o: 112, c: 135, h: 88, l: 148, up: false },
    { x: 208, o: 135, c: 106, h: 82, l: 148, up: true },
    { x: 238, o: 106, c: 125, h: 76, l: 138, up: false },
    { x: 268, o: 125, c: 94, h: 68, l: 135, up: true },
    { x: 298, o: 94, c: 115, h: 60, l: 128, up: false },
    { x: 328, o: 115, c: 80, h: 55, l: 125, up: true },
    { x: 358, o: 80, c: 102, h: 48, l: 118, up: false },
  ];

  const midPoints = candles.map((c) => ({ x: c.x, y: (c.o + c.c) / 2 }));
  const linePath = midPoints
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`)
    .join(" ");
  const areaPath =
    linePath +
    ` L ${midPoints[midPoints.length - 1].x} 230 L ${midPoints[0].x} 230 Z`;

  return (
    <div className="relative w-full h-full flex flex-col overflow-hidden select-none">
      {/* Ambient glow blobs */}
      <div
        className="absolute -top-24 -left-24 w-80 h-80 rounded-full blur-3xl"
        style={{ background: 'rgba(14,165,233,0.12)', animation: "pulse 4s ease-in-out infinite" }}
      />
      <div
        className="absolute bottom-16 -right-10 w-64 h-64 rounded-full blur-3xl"
        style={{ background: 'rgba(30,111,168,0.10)', animation: "pulse 6s ease-in-out infinite" }}
      />
      <div
        className="absolute top-1/2 left-1/3 w-40 h-40 rounded-full blur-3xl"
        style={{ background: 'rgba(30,111,168,0.08)', animation: "pulse 5s ease-in-out infinite" }}
      />

      {/* Main chart card */}
      <div className="relative z-10 flex-1 flex flex-col justify-center px-7 py-4">
        <div
          className="rounded-2xl overflow-hidden shadow-2xl"
          style={{
            background: "rgba(15,26,48,0.85)",
            border: '1px solid rgba(255,255,255,0.08)',
            backdropFilter: "blur(20px)",
          }}
        >
          {/* Chart topbar */}
          <div
            className="flex items-center justify-between px-5 py-3"
            style={{ background: "rgba(15,26,48,0.5)", borderBottom: '1px solid rgba(255,255,255,0.06)' }}
          >
            <div className="flex gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-[#0EA5E9]/70" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
            </div>
            <span className="text-[11px] font-mono text-gray-500 tracking-widest">
              NIFTY 50 · 1D
            </span>
            <span className="text-[11px] text-emerald-400 font-semibold">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
              </span>
              LIVE
            </span>
          </div>

          {/* Price + timeframes */}
          <div className="flex items-end justify-between px-5 pt-4 pb-1">
            <div>
              <div className="text-[22px] font-black text-white font-mono tracking-tight">
                {nifty.price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={`text-xs font-mono font-bold mt-0.5 ${nifty.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                {nifty.change >= 0 ? '▲' : '▼'} {Math.abs(nifty.change).toFixed(2)} &nbsp;{nifty.changePct >= 0 ? '+' : ''}{nifty.changePct.toFixed(2)}%
              </div>
            </div>
            <div className="flex gap-1 mb-1">
              {["1D", "1W", "1M", "3M"].map((p) => (
                <span
                  key={p}
                  className={`text-[10px] px-2 py-0.5 rounded-md font-bold cursor-pointer transition-colors ${p === "1D" ? "text-white" : "text-gray-600 hover:text-gray-400"}`}
                  style={p === "1D" ? { background: 'rgba(14,165,233,0.25)', color: '#0EA5E9' } : {}}
                >
                  {p}
                </span>
              ))}
            </div>
          </div>

          {/* SVG Candlestick Chart */}
          <div className="px-2 pb-1">
            <svg
              viewBox="0 0 386 240"
              className="w-full h-32"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="lg-area" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.22" />
                  <stop offset="100%" stopColor="#0EA5E9" stopOpacity="0" />
                </linearGradient>
                <linearGradient id="lg-line" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#0EA5E9" />
                  <stop offset="100%" stopColor="#0369A1" />
                </linearGradient>
                <filter
                  id="line-glow"
                  x="-10%"
                  y="-50%"
                  width="120%"
                  height="200%"
                >
                  <feGaussianBlur stdDeviation="2.5" result="b" />
                  <feMerge>
                    <feMergeNode in="b" />
                    <feMergeNode in="SourceGraphic" />
                  </feMerge>
                </filter>
              </defs>
              {/* Horizontal grid */}
              {[55, 95, 135, 175, 215].map((y) => (
                <line
                  key={y}
                  x1="15"
                  y1={y}
                  x2="375"
                  y2={y}
                  stroke="rgba(255,255,255,0.035)"
                  strokeWidth="1"
                />
              ))}
              {/* Candles */}
              {candles.map((c, i) => (
                <g
                  key={i}
                  style={{
                    animation: `fadeInUp 0.4s ease-out ${i * 0.06}s both`,
                  }}
                >
                  <line
                    x1={c.x}
                    y1={c.h}
                    x2={c.x}
                    y2={c.l}
                    stroke={c.up ? "#22c55e" : "#ef4444"}
                    strokeWidth="1.5"
                    opacity="0.65"
                  />
                  <rect
                    x={c.x - 7}
                    y={Math.min(c.o, c.c)}
                    width="14"
                    height={Math.max(2, Math.abs(c.o - c.c))}
                    fill={c.up ? "#22c55e" : "#ef4444"}
                    opacity="0.88"
                    rx="2"
                  />
                </g>
              ))}
              {/* Area */}
              <path d={areaPath} fill="url(#lg-area)" />
              {/* Trend line */}
              <path
                d={linePath}
                fill="none"
                stroke="url(#lg-line)"
                strokeWidth="2.5"
                strokeLinejoin="round"
                filter="url(#line-glow)"
                style={{
                  strokeDasharray: 1200,
                  strokeDashoffset: 1200,
                  animation: "drawLine 2.5s ease-out 0.3s forwards",
                }}
              />
              {/* Live pulse dot */}
              <circle cx="358" cy="102" r="3.5" fill="#0EA5E9">
                <animate
                  attributeName="r"
                  values="3.5;7;3.5"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity"
                  values="1;0.2;1"
                  dur="1.8s"
                  repeatCount="indefinite"
                />
              </circle>
            </svg>
          </div>

          {/* Mini stock row */}
          <div className="grid grid-cols-4 border-t border-white/5">
            {stockRow.map(({ s, p, c, up }, i) => (
              <div
                key={s}
                className={`px-3 py-2.5 text-center ${i < 3 ? "border-r border-white/5" : ""}`}
              >
                <div className="text-[9px] text-gray-600 font-bold uppercase tracking-wider">
                  {s}
                </div>
                <div className="text-[11px] font-mono text-gray-600 mt-0.5">
                  {p}
                </div>
                <div
                  className={`text-[10px] font-mono font-bold mt-0.5 ${up ? "text-emerald-600" : "text-red-500"}`}
                >
                  {c}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      <style>{`
                @keyframes drawLine { to { stroke-dashoffset: 0; } }
                @keyframes fadeInUp { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
            `}</style>
    </div>
  );
}

/* ─── Main Page ────────────────────────────────────────────────── */
export default function LoginPage() {
  usePageMeta(
    "Sign In to AlphaSync",
    "Log in to your AlphaSync paper trading account. Access your portfolio, strategies, and trading terminal."
  );
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const loginWithEmail = useAuthStore((s) => s.loginWithEmail);
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle);
  const resendVerification = useAuthStore((s) => s.resendVerification);
  const existingUser = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  // Check if user already has an active session with onboarding complete
  const hasActiveSession = existingUser && localStorage.getItem('alphasync_onboarded');

  const handleEmailLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await loginWithEmail(email, password);
      toast.success("Welcome back!");
      navigate(result.isNew ? "/select-mode" : "/dashboard");
    } catch (err) {
      const code = err.code;
      if (code === "auth/email-not-verified") {
        // Resend verification email automatically so the user gets a fresh link
        try {
          await resendVerification(email, password);
          toast.error("Email not verified. We've sent a new verification link — check your inbox.");
        } catch {
          toast.error("Email not verified. Check your inbox for the verification link.");
        }
        navigate("/verify-email", { state: { email, password } });
        return;
      } else if (code === "auth/user-not-found" || code === "auth/wrong-password" || code === "auth/invalid-credential") {
        toast.error("Invalid email or password");
      } else if (code === "auth/too-many-requests") {
        toast.error("Too many attempts. Try again later.");
      } else {
        toast.error(err.message || "Login failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      const result = await loginWithGoogle();
      if (result.isNew) {
        toast.success("Welcome to AlphaSync!");
      } else {
        toast.success("Welcome back!");
      }
      navigate("/select-mode");
    } catch (err) {
      if (err.code !== "auth/popup-closed-by-user") {
        toast.error(err.message || "Google sign-in failed");
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!email) return toast.error("Enter your email first");
    try {
      const { resetPassword } = useAuthStore.getState();
      await resetPassword(email);
      toast.success("Password reset email sent!");
    } catch {
      toast.error("Could not send reset email. Check your email address.");
    }
  };

  const fieldCls =
    "w-full py-3 rounded-xl text-sm placeholder-slate-400 border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[#00D4FF]/15 focus:border-[#00D4FF]";
  const fieldBg = "bg-slate-50 border-slate-300 text-slate-900";

  return (
    <div
      className="h-screen w-screen overflow-hidden flex"
      style={{ background: "#FFFFFF" }}
    >
      {/* LEFT — animated chart panel */}
      <AuthPanelLeft>
        <TradingAnimation />
      </AuthPanelLeft>

      {/* RIGHT — premium form */}
      <div
        className="flex-1 h-full flex items-center justify-center px-8 xl:px-12 relative overflow-hidden"
        style={{
          background: "#FFFFFF",
        }}
      >
        {/* Decorative glow */}
        <div
          className="absolute -top-10 -right-10 w-96 h-96 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(14,165,233,0.06) 0%, transparent 70%)",
          }}
        />
        <div
          className="absolute -bottom-10 -left-10 w-72 h-72 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(circle, rgba(30,111,168,0.04) 0%, transparent 70%)",
          }}
        />

        {/* Decorative corner lines */}
        <div className="absolute top-0 right-0 w-32 h-32 border-r border-t rounded-bl-3xl pointer-events-none" style={{ borderColor: 'rgba(14,165,233,0.1)' }} />
        <div className="absolute bottom-0 left-0 w-24 h-24 border-l border-b border-slate-200 rounded-tr-3xl pointer-events-none" />

        {/* Mobile logo */}
        <div className="lg:hidden absolute top-7 left-1/2 -translate-x-1/2">
          <a href="https://www.alphasync.app/">
            <img
              src="/logo.png"
              alt="AlphaSync"
              className="h-12 object-contain"
              style={{ filter: 'invert(1) hue-rotate(180deg)' }}
            />
          </a>
        </div>

        <div className="w-full max-w-[360px] relative z-10">
          {/* Live pill */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6" style={{ background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.3)' }}>
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#00AA88] opacity-75" />
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#00AA88]" />
            </span>
            <span className="text-[11px] font-semibold tracking-wide" style={{ color: '#007A99' }}>
              Live NSE &amp; BSE Markets
            </span>
          </div>

          {/* Dashboard shortcut — only visible when session is still active */}
          {hasActiveSession && (
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center gap-2 px-4 py-2 rounded-full text-[12px] font-bold mb-4 transition-all duration-200 hover:scale-[1.02] active:scale-[0.98]"
              style={{
                background: 'linear-gradient(135deg, #0F172A 0%, #1E3A5F 100%)',
                color: '#00D4FF',
                border: '1px solid rgba(0,212,255,0.25)',
                boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
              }}
            >
              <LayoutDashboard size={14} />
              Go to Dashboard
              <ArrowRight size={12} />
            </button>
          )}

          {/* Headline */}
          <div className="mb-7">
            <h1 className="text-[28px] font-black tracking-tight leading-tight mb-2" style={{ color: '#0F172A', fontFamily: 'var(--font-display)' }}>
              Welcome back
            </h1>
            <p className="text-[13px] leading-relaxed" style={{ color: '#475569' }}>
              Sign in to continue trading with your virtual portfolio.
            </p>
          </div>

          {/* Glass form card */}
          <div className="relative">
            {/* Gradient border */}
            <div
              className="absolute -inset-[1px] rounded-2xl pointer-events-none"
              style={{
                background:
                  "linear-gradient(135deg, rgba(14,165,233,0.12) 0%, rgba(226,232,240,0.4) 50%, rgba(30,111,168,0.06) 100%)",
              }}
            />
            <div
              className="relative rounded-2xl p-6"
              style={{
                background: "#FFFFFF",
                border: '1px solid #E2E8F0',
                boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
              }}
            >
              {/* Google Sign In */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={googleLoading}
                className="w-full flex items-center justify-center gap-3 py-3 rounded-xl text-[13px] font-bold border border-slate-200 hover:border-slate-300 bg-white hover:bg-slate-50 transition-all duration-200 active:scale-[0.98] disabled:opacity-50 mb-5"
                style={{ color: '#1E293B', borderColor: '#E2E8F0', boxShadow: '0 1px 3px rgba(0,0,0,0.08)' }}
              >
                {googleLoading ? (
                  <div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                )}
                {googleLoading ? "Signing in..." : "Continue with Google"}
              </button>

              {/* Divider */}
              <div className="flex items-center gap-3 mb-5">
                <div className="flex-1 h-px bg-slate-200" />
                <span className="text-[11px] text-slate-400 font-semibold uppercase tracking-widest">or</span>
                <div className="flex-1 h-px bg-slate-200" />
              </div>

              <form onSubmit={handleEmailLogin} className="space-y-5">
                {/* Email */}
                <div>
                  <label className="block text-[11px] font-bold text-slate-800 mb-2 uppercase tracking-widest">
                    Email Address
                  </label>
                  <div className="relative group">
                    <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-slate-400 group-focus-within:text-[#0EA5E9] transition-colors duration-200" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      required
                      className={`${fieldCls} ${fieldBg} pl-10 pr-4`}
                    />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[11px] font-bold text-slate-800 uppercase tracking-widest">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={handleForgotPassword}
                      className="text-[11px] font-semibold transition-colors"
                      style={{ color: '#00AACC' }}
                    >
                      Forgot?
                    </button>
                  </div>
                  <div className="relative group">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[15px] h-[15px] text-slate-400 group-focus-within:text-[#0EA5E9] transition-colors duration-200" />
                    <input
                      type={showPassword ? "text" : "password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Enter your password"
                      required
                      className={`${fieldCls} ${fieldBg} pl-10 pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-500 transition-colors"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* CTA */}
                <div className="pt-1">
                  <button
                    type="submit"
                    disabled={loading}
                    className="relative w-full flex items-center justify-center gap-2.5 py-3.5 text-[13px] font-black overflow-hidden transition-all duration-200 active:scale-[0.97] disabled:opacity-50 group"
                    style={{
                      background: 'var(--gold)',
                      color: 'var(--navy)',
                      borderRadius: '999px',
                      boxShadow: "0 4px 20px rgba(14,165,233,0.30)",
                    }}
                  >
                    {/* Shimmer */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/12 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-700 pointer-events-none" />
                    {loading ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        Sign In
                        <ArrowRight size={16} className="group-hover:translate-x-0.5 transition-transform duration-150" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Links */}
          <div className="mt-5 text-center space-y-2.5">
            <p className="text-[13px]" style={{ color: '#475569' }}>
              Don&apos;t have an account?{" "}
              <Link
                to="/register"
                className="font-bold transition-colors"
                style={{ color: '#0099CC' }}
              >
                Create free account
              </Link>
            </p>
            <div className="flex items-center justify-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-500/60" />
              <span className="text-[11px]" style={{ color: '#64748B' }}>
                All data is simulated. No real money involved.
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
