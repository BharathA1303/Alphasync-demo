import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "../stores/useAuthStore";
import { useTheme } from "../context/ThemeContext";
import api from "../services/api";
import toast from "react-hot-toast";
import {
  ShieldCheck,
  User,
  Lock,
  Moon,
  Sun,
  Camera,
  Image,
  Trash2,
  Palette,
  Bell,
  TrendingUp,
  Database,
  RotateCcw,
  Check,
  ChevronRight,
  Monitor,
  Type,
  BarChart3,
  Zap,
  CandlestickChart,
  LineChart,
  AreaChart,
  Hash,
  ShieldAlert,
  Download,
  Eye,
  EyeOff,
  Mail,
} from "lucide-react";

const TABS = [
  { id: "profile", label: "Profile", icon: User, section: "Account" },
  { id: "security", label: "Security", icon: Lock, section: "Account" },
  { id: "appearance", label: "Appearance", icon: Palette, section: "Preferences" },
  { id: "trading", label: "Trading", icon: TrendingUp, section: "Preferences" },
  { id: "notifications", label: "Notifications", icon: Bell, section: "Preferences" },
  { id: "data", label: "Data & Privacy", icon: Database, section: "System" },
];

// ── Avatar URL helper ─────────────────────────────────────────────────────────
const BACKEND_ORIGIN =
  import.meta.env.VITE_API_URL?.replace("/api", "") || "";

function resolveAvatarUrl(url) {
  if (!url) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${BACKEND_ORIGIN}${url}`;
}

// ── Name / color helpers ──────────────────────────────────────────────────────
function nameToColor(str = "") {
  const COLORS = [
    "#f59e0b", "#8b5cf6", "#0ea5e9", "#10b981",
    "#f59e0b", "#ef4444", "#ec4899", "#14b8a6",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++)
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return COLORS[Math.abs(hash) % COLORS.length];
}

function getInitials(user) {
  if (user?.full_name?.trim()) {
    const parts = user.full_name.trim().split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : parts[0].slice(0, 2).toUpperCase();
  }
  if (user?.email) return user.email[0].toUpperCase();
  return "?";
}

// ── Shared Avatar component ──────────────────────────────────────────────────
export function Avatar({ user, size = "lg", className = "" }) {
  const sizeMap = {
    sm: { outer: "w-8 h-8", text: "text-sm" },
    md: { outer: "w-10 h-10", text: "text-base" },
    lg: { outer: "w-20 h-20", text: "text-2xl" },
    xl: { outer: "w-24 h-24", text: "text-3xl" },
  };
  const { outer, text } = sizeMap[size] || sizeMap.lg;
  const initials = getInitials(user);
  const bg = nameToColor(user?.email || user?.username || "");
  const avatarUrl = resolveAvatarUrl(user?.avatar_url);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={initials}
        className={`${outer} rounded-full object-cover ring-2 ring-white/10 ${className}`}
      />
    );
  }
  return (
    <div
      className={`${outer} rounded-full flex items-center justify-center font-bold text-white ring-2 ring-white/10 select-none ${text} ${className}`}
      style={{ background: `linear-gradient(135deg, ${bg}cc, ${bg})` }}
    >
      {initials}
    </div>
  );
}

// ── Reusable Setting Row ─────────────────────────────────────────────────────
function SettingRow({ icon: Icon, iconColor = "text-primary-600", title, description, children, noBorder = false }) {
  return (
    <div className={`flex items-center justify-between p-4 rounded-lg bg-surface-900/40 border border-edge/[0.03] ${noBorder ? '' : 'mb-3'}`}>
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {Icon && <Icon className={`w-5 h-5 flex-shrink-0 ${iconColor}`} />}
        <div className="min-w-0">
          <div className="text-sm font-medium text-heading">{title}</div>
          {description && <div className="text-xs text-gray-500 mt-0.5">{description}</div>}
        </div>
      </div>
      <div className="flex-shrink-0 ml-4">{children}</div>
    </div>
  );
}

// ── Toggle Switch ────────────────────────────────────────────────────────────
function Toggle({ enabled, onChange, color = "bg-primary-600" }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? color : "bg-gray-600/40"}`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${enabled ? "left-[22px]" : "left-0.5"}`}
      />
    </button>
  );
}

// ── Option Selector (pill group) ─────────────────────────────────────────────
function OptionPills({ options, value, onChange }) {
  return (
    <div className="flex gap-1.5 flex-wrap">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
            value === opt.value
              ? "bg-primary-600/20 text-primary-500 ring-1 ring-primary-500/30"
              : "bg-surface-900/40 text-gray-500 hover:text-heading hover:bg-surface-900/60"
          }`}
        >
          {opt.icon && <opt.icon className="w-3 h-3 inline mr-1.5 -mt-px" />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Color Swatch Selector ────────────────────────────────────────────────────
const ACCENT_COLORS = [
  { value: "cyan", color: "#00bcd4", label: "Cyan" },
  { value: "blue", color: "#3b82f6", label: "Blue" },
  { value: "green", color: "#10b981", label: "Green" },
  { value: "purple", color: "#8b5cf6", label: "Purple" },
  { value: "orange", color: "#f59e0b", label: "Orange" },
  { value: "rose", color: "#f43f5e", label: "Rose" },
];

function ColorSwatches({ value, onChange }) {
  return (
    <div className="flex gap-2">
      {ACCENT_COLORS.map((c) => (
        <button
          key={c.value}
          onClick={() => onChange(c.value)}
          title={c.label}
          className={`w-7 h-7 rounded-full transition-all duration-150 flex items-center justify-center ${
            value === c.value ? "ring-2 ring-offset-2 ring-offset-surface-800 scale-110" : "hover:scale-105"
          }`}
          style={{
            background: c.color,
            ringColor: value === c.value ? c.color : undefined,
          }}
        >
          {value === c.value && <Check className="w-3.5 h-3.5 text-white" />}
        </button>
      ))}
    </div>
  );
}

// ── Avatar Upload Panel ───────────────────────────────────────────────────────
function AvatarUpload({ user, onUpdate }) {
  const fileRef = useRef(null);
  const [preview, setPreview] = useState(() =>
    resolveAvatarUrl(user?.avatar_url),
  );
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  useEffect(() => {
    setPreview(resolveAvatarUrl(user?.avatar_url));
  }, [user?.avatar_url]);

  const processFile = useCallback(
    async (file) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        toast.error("Please select an image file");
        return;
      }
      if (file.size > 2 * 1024 * 1024) {
        toast.error("Image must be under 2MB");
        return;
      }

      const localUrl = URL.createObjectURL(file);
      setPreview(localUrl);
      setUploading(true);

      try {
        const formData = new FormData();
        formData.append("avatar", file);
        // Let axios/browser set Content-Type with correct multipart boundary
        const res = await api.post("/user/avatar", formData, {
          headers: { "Content-Type": undefined },
        });
        const resolved = resolveAvatarUrl(res.data.avatar_url);
        onUpdate({ avatar_url: res.data.avatar_url });
        setPreview(resolved);
        toast.success("Profile photo updated!");
      } catch (err) {
        setPreview(resolveAvatarUrl(user?.avatar_url));
        toast.error(err.response?.data?.detail || "Upload failed");
      } finally {
        setUploading(false);
        URL.revokeObjectURL(localUrl);
      }
    },
    [user?.avatar_url, onUpdate],
  );

  const handleFileChange = (e) => processFile(e.target.files[0]);
  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files[0]);
  };

  const handleRemove = async () => {
    if (!preview) return;
    setUploading(true);
    try {
      await api.delete("/user/avatar");
      onUpdate({ avatar_url: null });
      setPreview(null);
      toast.success("Profile photo removed");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to remove photo");
    } finally {
      setUploading(false);
    }
  };

  const initials = getInitials(user);
  const bg = nameToColor(user?.email || user?.username || "");

  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6 p-5 rounded-xl bg-surface-900/40 border border-edge/[0.05] mb-6">
      <div className="relative flex-shrink-0 group">
        <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-surface-800 shadow-xl">
          {preview ? (
            <img src={preview} alt="Profile" className="w-full h-full object-cover" />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center text-3xl font-bold text-white select-none"
              style={{ background: `linear-gradient(135deg, ${bg}cc, ${bg})` }}
            >
              {initials}
            </div>
          )}
        </div>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="absolute inset-0 rounded-full flex flex-col items-center justify-center bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer disabled:cursor-not-allowed"
          title="Change photo"
        >
          {uploading ? (
            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          ) : (
            <>
              <Camera className="w-6 h-6 text-white" />
              <span className="text-[10px] text-white/80 mt-1 font-medium">Change</span>
            </>
          )}
        </button>
        <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-emerald-500 ring-2 ring-surface-800" />
      </div>

      <div className="flex flex-col items-center sm:items-start gap-3 flex-1 min-w-0">
        <div className="text-center sm:text-left">
          <p className="text-sm font-semibold text-heading">
            {user?.full_name || user?.username || "Your Name"}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">{user?.email}</p>
          <p className="text-[11px] text-gray-600 mt-1">JPG, PNG, GIF or WebP · Max 2MB</p>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileRef.current?.click()}
          className={`w-full max-w-xs border-2 border-dashed rounded-xl px-4 py-3 text-center transition-colors duration-150 cursor-pointer ${
            dragOver
              ? "border-primary-500 bg-primary-500/10"
              : "border-edge/20 hover:border-primary-500/40 hover:bg-primary-500/5"
          }`}
        >
          <Image className="w-5 h-5 text-gray-500 mx-auto mb-1" />
          <p className="text-[11px] text-gray-500">
            <span className="text-primary-600 font-medium">Click to upload</span> or drag & drop
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-600/15 text-primary-600 hover:bg-primary-600/25 transition-colors disabled:opacity-50"
          >
            <Camera className="w-3.5 h-3.5" />
            {uploading ? "Uploading\u2026" : "Upload Photo"}
          </button>
          {preview && (
            <button
              onClick={handleRemove}
              disabled={uploading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors disabled:opacity-50"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Remove
            </button>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

// ── Section Header ────────────────────────────────────────────────────────────
function SectionHeader({ title, description }) {
  return (
    <div className="mb-5">
      <h2 className="section-title text-xs">{title}</h2>
      {description && <p className="text-[11px] text-gray-500 mt-1">{description}</p>}
    </div>
  );
}

// ── Main Settings Page ────────────────────────────────────────────────────────
export default function SettingsPage() {
  const user = useAuthStore((s) => s.user);
  const updateUser = useAuthStore((s) => s.updateUser);
  const { theme, setTheme, prefs, updatePrefs, resetPrefs } = useTheme();

  const [profile, setProfile] = useState({ full_name: "", phone: "" });
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("profile");

  // Notification preferences (localStorage-based)
  const [notifPrefs, setNotifPrefs] = useState(() => {
    try {
      const saved = localStorage.getItem('alphasync_notif_prefs');
      return saved ? JSON.parse(saved) : {
        orderExecuted: true,
        orderFailed: true,
        priceAlerts: true,
        marketOpen: false,
        marketClose: false,
        dailySummary: false,
        weeklyReport: false,
        soundEnabled: true,
        browserNotifications: false,
      };
    } catch { return { orderExecuted: true, orderFailed: true, priceAlerts: true, marketOpen: false, marketClose: false, dailySummary: false, weeklyReport: false, soundEnabled: true, browserNotifications: false }; }
  });

  useEffect(() => {
    localStorage.setItem('alphasync_notif_prefs', JSON.stringify(notifPrefs));
  }, [notifPrefs]);

  const updateNotif = (key, val) => setNotifPrefs((p) => ({ ...p, [key]: val }));

  // Fetch full profile with phone on mount
  useEffect(() => {
    if (user) {
      setProfile({ full_name: user.full_name || "", phone: user.phone || "" });
      // If phone is missing from store, fetch from profile endpoint
      if (user.phone === undefined) {
        api.get("/user/profile").then((res) => {
          const p = res.data;
          updateUser({ phone: p.phone || "" });
          setProfile((prev) => ({ ...prev, phone: p.phone || "" }));
        }).catch(() => {});
      }
    }
  }, [user]);

  const isGoogleAuth = user?.auth_provider === 'google.com';

  const saveProfile = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await api.put("/user/profile", profile);
      // Use server-confirmed data if available, fall back to local
      const serverUser = res.data?.user;
      if (serverUser) {
        updateUser(serverUser);
      } else {
        updateUser(profile);
      }
      toast.success("Profile updated");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Update failed");
    }
    setLoading(false);
  };

  const handleResetPassword = async () => {
    if (!user?.email) return toast.error("No email found");
    try {
      const { resetPassword } = useAuthStore.getState();
      await resetPassword(user.email);
      toast.success("Password reset email sent! Check your inbox.");
    } catch {
      toast.error("Could not send reset email");
    }
  };

  const handleExportData = () => {
    const data = {
      profile: {
        email: user?.email,
        username: user?.username,
        full_name: user?.full_name,
        created_at: user?.created_at,
      },
      preferences: {
        theme,
        ui: prefs,
        notifications: notifPrefs,
      },
      exported_at: new Date().toISOString(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `alphasync-settings-${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Settings exported");
  };

  // Group tabs by section
  const sections = {};
  TABS.forEach((t) => {
    if (!sections[t.section]) sections[t.section] = [];
    sections[t.section].push(t);
  });

  return (
    <div className="p-4 lg:p-6 max-w-4xl animate-fade-in">
      <div className="mb-6">
        <h1 className="text-2xl font-display font-semibold text-heading">Settings</h1>
        <p className="text-gray-500 text-sm mt-0.5">Manage your account preferences</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6">
        {/* Tab sidebar */}
        <div className="flex sm:flex-col gap-1 sm:w-44 flex-shrink-0 overflow-x-auto sm:overflow-visible">
          {Object.entries(sections).map(([section, tabs]) => (
            <div key={section} className="sm:mb-3">
              <div className="hidden sm:block text-[10px] font-bold text-gray-600 uppercase tracking-widest px-3 mb-1.5">
                {section}
              </div>
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap w-full
                    ${activeTab === id
                      ? "bg-primary-600/15 text-primary-600 border-l-[3px] border-primary-500"
                      : "text-gray-400 hover:text-heading hover:bg-overlay/5 border-l-[3px] border-transparent"
                    }`}
                >
                  <Icon className="w-4 h-4 flex-shrink-0" />
                  {label}
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">

          {/* ═══════════════════ PROFILE ═══════════════════ */}
          {activeTab === "profile" && (
            <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
              <SectionHeader title="Profile Information" description="Update your personal details and profile photo" />
              <AvatarUpload user={user} onUpdate={updateUser} />
              <form onSubmit={saveProfile} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="label-text">Email</label>
                    <input
                      type="email"
                      value={user?.email || ""}
                      disabled
                      className="input-field opacity-60 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="label-text">Username</label>
                    <input
                      type="text"
                      value={user?.username || ""}
                      disabled
                      className="input-field opacity-60 cursor-not-allowed"
                    />
                  </div>
                  <div>
                    <label className="label-text">Full Name</label>
                    <input
                      type="text"
                      value={profile.full_name}
                      onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))}
                      className="input-field"
                    />
                  </div>
                  <div>
                    <label className="label-text">Phone Number</label>
                    <input
                      type="tel"
                      value={profile.phone}
                      onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))}
                      placeholder="+91 00000 00000"
                      className="input-field"
                    />
                    <p className="text-[10px] text-gray-600 mt-1">Optional. Used for account recovery only.</p>
                  </div>
                </div>

                {/* Account info badges */}
                <div className="flex flex-wrap gap-2 pt-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-primary-600/10 text-primary-600">
                    <Mail className="w-3 h-3" />
                    {isGoogleAuth ? "Google Account" : "Email Account"}
                  </span>
                  {user?.is_verified && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-500">
                      <ShieldCheck className="w-3 h-3" />
                      Verified
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-surface-900/60 text-gray-500">
                    Joined {user?.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}
                  </span>
                </div>

                <button type="submit" disabled={loading} className="btn-primary text-sm">
                  {loading ? "Saving..." : "Save Changes"}
                </button>
              </form>
            </div>
          )}

          {/* ═══════════════════ SECURITY ═══════════════════ */}
          {activeTab === "security" && (
            <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
              <SectionHeader title="Account Security" description="Manage your authentication and password settings" />
              <div className="space-y-3">
                {/* Auth provider */}
                <SettingRow
                  icon={ShieldCheck}
                  iconColor="text-emerald-600"
                  title="Authentication Provider"
                  description={isGoogleAuth
                    ? "Your account is linked to Google. Password is managed by Google."
                    : "Your account uses email & password via Firebase Authentication"
                  }
                >
                  <span className="text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-full">
                    {isGoogleAuth ? "Google" : "Active"}
                  </span>
                </SettingRow>

                {/* Password reset — only for email/password users */}
                {!isGoogleAuth && (
                  <SettingRow
                    icon={Lock}
                    title="Reset Password"
                    description="We'll send a password reset link to your email"
                  >
                    <button onClick={handleResetPassword} className="btn-primary text-xs px-3 py-1.5" style={{ height: 'auto' }}>
                      Send Reset Email
                    </button>
                  </SettingRow>
                )}

                {/* Google users — password info */}
                {isGoogleAuth && (
                  <SettingRow
                    icon={Lock}
                    title="Password"
                    description="Your password is managed through your Google account. Use Google's security settings to change it."
                  >
                    <a
                      href="https://myaccount.google.com/security"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-primary-600 hover:text-primary-500 transition-colors flex items-center gap-1"
                    >
                      Google Security <ChevronRight className="w-3 h-3" />
                    </a>
                  </SettingRow>
                )}

                {/* Email verification status */}
                <SettingRow
                  icon={Mail}
                  iconColor={user?.is_verified ? "text-emerald-600" : "text-amber-500"}
                  title="Email Verification"
                  description={user?.is_verified ? `${user.email} is verified` : "Your email is not yet verified"}
                >
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    user?.is_verified
                      ? "text-emerald-600 bg-emerald-500/10"
                      : "text-amber-500 bg-amber-500/10"
                  }`}>
                    {user?.is_verified ? "Verified" : "Unverified"}
                  </span>
                </SettingRow>

                {/* Active sessions info */}
                <SettingRow
                  icon={ShieldAlert}
                  iconColor="text-amber-500"
                  title="Active Sessions"
                  description="You're currently signed in on this device"
                >
                  <span className="text-xs font-semibold text-gray-500 bg-surface-900/60 px-2.5 py-1 rounded-full">
                    1 Device
                  </span>
                </SettingRow>
              </div>
            </div>
          )}

          {/* ═══════════════════ APPEARANCE ═══════════════════ */}
          {activeTab === "appearance" && (
            <div className="space-y-4">
              {/* Theme */}
              <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
                <SectionHeader title="Theme" description="Choose how AlphaSync looks to you" />

                {/* Theme cards */}
                <div className="grid grid-cols-3 gap-3 mb-5">
                  {[
                    { value: "light", label: "Light", icon: Sun, desc: "Clean & bright" },
                    { value: "dark", label: "Dark", icon: Moon, desc: "Easy on the eyes" },
                    { value: "system", label: "System", icon: Monitor, desc: "Match your OS" },
                  ].map((t) => (
                    <button
                      key={t.value}
                      onClick={() => {
                        if (t.value === "system") {
                          const sys = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
                          setTheme(sys);
                        } else {
                          setTheme(t.value);
                        }
                      }}
                      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all duration-200 ${
                        (t.value === "system" ? false : theme === t.value)
                          ? "border-primary-500/50 bg-primary-600/10 ring-1 ring-primary-500/20"
                          : "border-edge/10 bg-surface-900/40 hover:border-edge/20 hover:bg-surface-900/60"
                      }`}
                    >
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                        (t.value === "system" ? false : theme === t.value) ? "bg-primary-600/20" : "bg-surface-900/60"
                      }`}>
                        <t.icon className={`w-5 h-5 ${
                          (t.value === "system" ? false : theme === t.value) ? "text-primary-500" : "text-gray-500"
                        }`} />
                      </div>
                      <div className="text-center">
                        <div className="text-xs font-semibold text-heading">{t.label}</div>
                        <div className="text-[10px] text-gray-500">{t.desc}</div>
                      </div>
                    </button>
                  ))}
                </div>

                {/* Accent color */}
                <div className="mb-5">
                  <div className="text-xs font-semibold text-heading mb-2">Accent Color</div>
                  <p className="text-[11px] text-gray-500 mb-3">Choose a primary accent color for buttons and highlights</p>
                  <ColorSwatches value={prefs.accentColor} onChange={(v) => updatePrefs({ accentColor: v })} />
                </div>
              </div>

              {/* Typography & Display */}
              <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
                <SectionHeader title="Display" description="Customize text size and visual preferences" />
                <div className="space-y-4">
                  {/* Font size */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Type className="w-4 h-4 text-gray-500" />
                      <span className="text-xs font-semibold text-heading">Font Size</span>
                    </div>
                    <OptionPills
                      options={[
                        { value: "small", label: "Small" },
                        { value: "medium", label: "Medium" },
                        { value: "large", label: "Large" },
                      ]}
                      value={prefs.fontSize}
                      onChange={(v) => updatePrefs({ fontSize: v })}
                    />
                    <p className="text-[10px] text-gray-600 mt-1.5">Scales all text and UI elements across the app</p>
                  </div>

                  {/* Chart style */}
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <BarChart3 className="w-4 h-4 text-gray-500" />
                      <span className="text-xs font-semibold text-heading">Default Chart Style</span>
                    </div>
                    <OptionPills
                      options={[
                        { value: "candles", label: "Candlestick", icon: CandlestickChart },
                        { value: "line", label: "Line", icon: LineChart },
                        { value: "area", label: "Area", icon: AreaChart },
                      ]}
                      value={prefs.chartStyle}
                      onChange={(v) => updatePrefs({ chartStyle: v })}
                    />
                  </div>

                  {/* Animations toggle */}
                  <SettingRow
                    icon={Zap}
                    iconColor="text-amber-500"
                    title="Animations"
                    description="Enable smooth transitions and motion effects"
                    noBorder
                  >
                    <Toggle
                      enabled={prefs.animationsEnabled}
                      onChange={(v) => updatePrefs({ animationsEnabled: v })}
                    />
                  </SettingRow>
                </div>
              </div>

              {/* Reset */}
              <div className="flex justify-end">
                <button
                  onClick={() => { resetPrefs(); toast.success("Preferences reset to defaults"); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-gray-500 hover:text-heading hover:bg-surface-900/60 transition-colors"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Reset to Defaults
                </button>
              </div>
            </div>
          )}

          {/* ═══════════════════ TRADING ═══════════════════ */}
          {activeTab === "trading" && (
            <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
              <SectionHeader title="Trading Preferences" description="Customize your trading experience and order defaults" />
              <div className="space-y-3">
                {/* Default order type */}
                <div className="p-4 rounded-lg bg-surface-900/40 border border-edge/[0.03] mb-3">
                  <div className="flex items-center gap-2 mb-3">
                    <TrendingUp className="w-4 h-4 text-primary-600" />
                    <span className="text-sm font-medium text-heading">Default Order Type</span>
                  </div>
                  <OptionPills
                    options={[
                      { value: "MARKET", label: "Market" },
                      { value: "LIMIT", label: "Limit" },
                    ]}
                    value={prefs.defaultOrderType}
                    onChange={(v) => updatePrefs({ defaultOrderType: v })}
                  />
                  <p className="text-[10px] text-gray-600 mt-2">
                    {prefs.defaultOrderType === "MARKET"
                      ? "Market orders execute immediately at the best available price"
                      : "Limit orders let you set a specific price for execution"
                    }
                  </p>
                </div>

                {/* Confirm before order */}
                <SettingRow
                  icon={ShieldCheck}
                  iconColor="text-amber-500"
                  title="Confirm Before Placing Order"
                  description="Show a confirmation dialog before submitting orders"
                >
                  <Toggle
                    enabled={prefs.confirmBeforeOrder}
                    onChange={(v) => updatePrefs({ confirmBeforeOrder: v })}
                  />
                </SettingRow>

                {/* P&L display options */}
                <SettingRow
                  icon={Eye}
                  title="Show P&L Percentage"
                  description="Display percentage change alongside P&L values"
                >
                  <Toggle
                    enabled={prefs.showPnlPercent}
                    onChange={(v) => updatePrefs({ showPnlPercent: v })}
                  />
                </SettingRow>

                <SettingRow
                  icon={Hash}
                  title="Show P&L Value"
                  description="Display absolute rupee P&L values"
                >
                  <Toggle
                    enabled={prefs.showPnlValue}
                    onChange={(v) => updatePrefs({ showPnlValue: v })}
                  />
                </SettingRow>

                <SettingRow
                  icon={Type}
                  title="Compact Numbers"
                  description="Show 1.2L instead of 1,20,000 for large values"
                >
                  <Toggle
                    enabled={prefs.compactNumbers}
                    onChange={(v) => updatePrefs({ compactNumbers: v })}
                  />
                </SettingRow>
              </div>
            </div>
          )}

          {/* ═══════════════════ NOTIFICATIONS ═══════════════════ */}
          {activeTab === "notifications" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
                <SectionHeader title="Order Notifications" description="Get notified about your trading activity" />
                <div className="space-y-3">
                  <SettingRow
                    icon={Check}
                    iconColor="text-emerald-500"
                    title="Order Executed"
                    description="When your buy or sell order is successfully executed"
                  >
                    <Toggle enabled={notifPrefs.orderExecuted} onChange={(v) => updateNotif('orderExecuted', v)} />
                  </SettingRow>
                  <SettingRow
                    icon={ShieldAlert}
                    iconColor="text-red-500"
                    title="Order Failed"
                    description="When an order fails or is rejected"
                  >
                    <Toggle enabled={notifPrefs.orderFailed} onChange={(v) => updateNotif('orderFailed', v)} />
                  </SettingRow>
                  <SettingRow
                    icon={TrendingUp}
                    title="Price Alerts"
                    description="When a stock hits your target price"
                  >
                    <Toggle enabled={notifPrefs.priceAlerts} onChange={(v) => updateNotif('priceAlerts', v)} />
                  </SettingRow>
                </div>
              </div>

              <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
                <SectionHeader title="Market Notifications" description="Stay informed about market events" />
                <div className="space-y-3">
                  <SettingRow
                    icon={Bell}
                    iconColor="text-emerald-500"
                    title="Market Open"
                    description="Reminder when the market opens at 9:15 AM"
                  >
                    <Toggle enabled={notifPrefs.marketOpen} onChange={(v) => updateNotif('marketOpen', v)} />
                  </SettingRow>
                  <SettingRow
                    icon={Bell}
                    iconColor="text-amber-500"
                    title="Market Close"
                    description="Reminder before market closes at 3:30 PM"
                  >
                    <Toggle enabled={notifPrefs.marketClose} onChange={(v) => updateNotif('marketClose', v)} />
                  </SettingRow>
                </div>
              </div>

              <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
                <SectionHeader title="Reports" description="Periodic summaries of your portfolio performance" />
                <div className="space-y-3">
                  <SettingRow
                    icon={BarChart3}
                    title="Daily Summary"
                    description="End-of-day P&L and order summary"
                  >
                    <Toggle enabled={notifPrefs.dailySummary} onChange={(v) => updateNotif('dailySummary', v)} />
                  </SettingRow>
                  <SettingRow
                    icon={BarChart3}
                    iconColor="text-purple-500"
                    title="Weekly Report"
                    description="Weekly portfolio performance overview"
                  >
                    <Toggle enabled={notifPrefs.weeklyReport} onChange={(v) => updateNotif('weeklyReport', v)} />
                  </SettingRow>
                </div>
              </div>

              <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
                <SectionHeader title="Delivery" description="How you receive notifications" />
                <div className="space-y-3">
                  <SettingRow
                    icon={Zap}
                    iconColor="text-amber-500"
                    title="Sound Effects"
                    description="Play sounds for order confirmations and alerts"
                  >
                    <Toggle enabled={notifPrefs.soundEnabled} onChange={(v) => updateNotif('soundEnabled', v)} />
                  </SettingRow>
                  <SettingRow
                    icon={Bell}
                    title="Browser Notifications"
                    description="Show desktop notifications (requires browser permission)"
                  >
                    <Toggle
                      enabled={notifPrefs.browserNotifications}
                      onChange={(v) => {
                        if (v && 'Notification' in window && Notification.permission !== 'granted') {
                          Notification.requestPermission().then((perm) => {
                            updateNotif('browserNotifications', perm === 'granted');
                            if (perm !== 'granted') toast.error("Browser notification permission denied");
                          });
                        } else {
                          updateNotif('browserNotifications', v);
                        }
                      }}
                    />
                  </SettingRow>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════ DATA & PRIVACY ═══════════════════ */}
          {activeTab === "data" && (
            <div className="space-y-4">
              <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
                <SectionHeader title="Your Data" description="Manage your data and local storage" />
                <div className="space-y-3">
                  <SettingRow
                    icon={Download}
                    title="Export Settings"
                    description="Download your preferences and settings as a JSON file"
                  >
                    <button
                      onClick={handleExportData}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-primary-600/15 text-primary-600 hover:bg-primary-600/25 transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export
                    </button>
                  </SettingRow>

                  <SettingRow
                    icon={Trash2}
                    iconColor="text-red-500"
                    title="Clear Local Storage"
                    description="Reset all cached data and preferences on this device. You'll stay logged in."
                  >
                    <button
                      onClick={() => {
                        const keep = ['alphasync_token', 'alphasync_user'];
                        const keys = Object.keys(localStorage).filter((k) => k.startsWith('alphasync_') && !keep.includes(k));
                        keys.forEach((k) => localStorage.removeItem(k));
                        toast.success(`Cleared ${keys.length} cached items`);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear Cache
                    </button>
                  </SettingRow>
                </div>
              </div>

              <div className="rounded-xl border border-edge/5 bg-surface-900/60 p-6">
                <SectionHeader title="Privacy" description="How your data is handled" />
                <div className="space-y-3">
                  <SettingRow
                    icon={ShieldCheck}
                    iconColor="text-emerald-600"
                    title="Data Storage"
                    description="All trading data is simulated. No real money or broker connections are stored permanently."
                    noBorder
                  >
                    <span className="text-xs font-semibold text-emerald-600 bg-emerald-500/10 px-2.5 py-1 rounded-full">
                      Safe
                    </span>
                  </SettingRow>
                  <SettingRow
                    icon={Lock}
                    iconColor="text-primary-600"
                    title="Encryption"
                    description="Broker credentials are encrypted with AES-256-GCM. API keys never stored in plain text."
                    noBorder
                  >
                    <span className="text-xs font-semibold text-primary-600 bg-primary-600/10 px-2.5 py-1 rounded-full">
                      AES-256
                    </span>
                  </SettingRow>
                  <SettingRow
                    icon={Eye}
                    iconColor="text-gray-500"
                    title="Analytics"
                    description="We only track basic usage events (logins, page views) for product improvement. No personal trading data is shared."
                    noBorder
                  >
                    <span className="text-xs font-semibold text-gray-500 bg-surface-900/60 px-2.5 py-1 rounded-full">
                      Minimal
                    </span>
                  </SettingRow>
                </div>
              </div>

              {/* Version info */}
              <div className="text-center py-3">
                <p className="text-[11px] text-gray-600">AlphaSync v1.0.0 · Paper Trading Platform</p>
                <p className="text-[10px] text-gray-600 mt-0.5">All data is simulated. No real money involved.</p>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
