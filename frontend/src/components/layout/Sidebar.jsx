import { NavLink, useNavigate } from "react-router-dom";
import { useAuthStore } from "../../stores/useAuthStore";
import Tooltip from "../ui/Tooltip";
import { cn } from "../../utils/cn";
import { SIDEBAR_EXPANDED_W, SIDEBAR_COLLAPSED_W } from "../../utils/constants";
import {
  LayoutDashboard,
  ChartCandlestick,
  Briefcase,
  Bot,
  Shield,
  Settings,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  FlaskConical,
  Globe,
  ClipboardList,
  Landmark,
} from "lucide-react";

/* ─── Avatar helpers ─────────────────────────────────────── */
function nameToColor(str = "") {
  const COLORS = [
    "#0EA5E9",
    "#0369A1",
    "#1E6FA8",
    "#10b981",
    "#c78d5e",
    "#ef4444",
    "#1A2B4A",
    "#14b8a6",
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

/** Shows the user's photo if uploaded, otherwise their initials on a colored circle */
function UserAvatar({ user, size = 8 }) {
  const avatarUrl = user?.avatar_url; // e.g. /uploads/avatars/x.jpg — proxied by Vite
  const initials = getInitials(user);
  const bg = nameToColor(user?.email || user?.username || "");
  const dim = `w-${size} h-${size}`;

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={initials}
        className={`${dim} rounded-full object-cover flex-shrink-0 ring-1 ring-white/10`}
        onError={(e) => {
          e.currentTarget.style.display = "none";
        }}
      />
    );
  }

  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center flex-shrink-0 text-white font-semibold text-xs select-none ring-1 ring-white/10`}
      style={{ background: `linear-gradient(135deg, ${bg}cc, ${bg})` }}
    >
      {initials}
    </div>
  );
}

/* ─── Section definitions ────────────────────────────────── */
const NAV_SECTIONS = [
  {
    label: "Main",
    items: [
      { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
      { to: "/terminal", icon: ChartCandlestick, label: "Terminal" },
      { to: "/market", icon: Globe, label: "Market" },
    ],
  },
  {
    label: "Trading",
    items: [
      { to: "/portfolio", icon: Briefcase, label: "Portfolio" },
      { to: "/futures", icon: Landmark, label: "Futures" },
      { to: "/orders", icon: ClipboardList, label: "Orders" },
      { to: "/algo", icon: Bot, label: "Algo Trading" },
      { to: "/zeroloss", icon: Shield, label: "ZeroLoss" },
    ],
  },
  {
    label: "System",
    items: [{ to: "/settings", icon: Settings, label: "Settings" }],
  },
];

/* ─── Reusable nav item ──────────────────────────────────── */
function SidebarItem({ to, icon: Icon, label, collapsed }) {
  const link = (
    <NavLink
      to={to}
      aria-label={label}
      className={({ isActive }) =>
        cn(
          "relative flex items-center h-10 rounded-lg transition-all duration-200 ease-out",
          "text-[13px]",
          collapsed
            ? "justify-center w-10 mx-auto"
            : "gap-3 px-3",
          isActive
            ? collapsed
              ? "bg-blue-600/15 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/25"
              : "bg-blue-600/10 text-blue-600 dark:text-blue-400 border-l-[3px] border-blue-600 dark:border-blue-400 font-medium"
            : collapsed
              ? "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-overlay/[0.06]"
              : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-overlay/[0.04] border-l-[3px] border-transparent font-normal",
        )
      }
    >
      <Icon className="w-5 h-5 flex-shrink-0" />
      {!collapsed && (
        <span className="whitespace-nowrap">
          {label}
        </span>
      )}
    </NavLink>
  );

  if (collapsed) {
    return (
      <Tooltip content={label} position="right" delay={200}>
        {link}
      </Tooltip>
    );
  }
  return link;
}

/* ─── Section label ──────────────────────────────────────── */
function SectionLabel({ label, collapsed }) {
  if (collapsed) return <div className="h-2" />;
  return (
    <p className="px-3 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500 dark:text-slate-400 select-none">
      {label}
    </p>
  );
}

export default function Sidebar({ collapsed, onToggle }) {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user); // reactive — updates instantly on photo change
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  return (
    <>
      {/* Mobile overlay */}
      {!collapsed && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden backdrop-blur-[2px]"
          onClick={onToggle}
          aria-hidden="true"
        />
      )}

      <aside
        style={{ width: collapsed ? SIDEBAR_COLLAPSED_W : SIDEBAR_EXPANDED_W }}
        className={cn(
          "fixed left-0 top-0 h-screen z-40 flex flex-col",
          "bg-slate-50 dark:bg-surface-900 border-r border-slate-200 dark:border-edge/10",
          "transition-[width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] overflow-hidden",
          collapsed
            ? "max-lg:-translate-x-full"
            : "max-lg:translate-x-0 max-lg:w-[240px]",
        )}
      >
        {/* ── Brand row ── */}
        <div
          className={cn(
            "flex-shrink-0 transition-all duration-300",
            collapsed
              ? "flex flex-col items-center gap-1 py-2.5 px-2"
              : "flex flex-col gap-0.5 justify-center h-20 px-4",
          )}
        >
          <div className="flex items-center justify-between w-full">
            {collapsed ? (
              <a href="https://www.alphasync.app/">
                <img
                  src="/logo1.png"
                  alt="AlphaSync"
                  className="h-9 w-9 object-contain flex-shrink-0 transition-all duration-300 logo-light-adapt"
                />
              </a>
            ) : (
              <a href="https://www.alphasync.app/" className="block min-w-0 flex-1">
                <img
                  src="/logo-full.png"
                  alt="AlphaSync"
                  className="h-14 max-w-[180px] object-contain object-left transition-all duration-300 logo-light-adapt"
                />
              </a>
            )}
            <button
              onClick={onToggle}
              className={cn(
                "rounded-md text-gray-500 hover:text-gray-700 hover:bg-overlay/[0.06] transition-all duration-200 flex-shrink-0",
                collapsed ? "p-1 mt-0.5" : "p-1.5",
              )}
              title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            >
              {collapsed ? (
                <PanelLeftOpen className="w-3.5 h-3.5" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>
          {/* Tagline — only visible when collapsed (expanded version is inline with logo) */}
        </div>

        {/* ── Divider ── */}
        <div className="mx-3 h-px bg-edge/8" />

        {/* ── Navigation ── */}
        <nav className="flex-1 px-2.5 overflow-y-auto overflow-x-hidden">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label}>
              <SectionLabel label={section.label} collapsed={collapsed} />
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <SidebarItem key={item.to} {...item} collapsed={collapsed} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* ── Divider ── */}
        <div className="mx-3 h-px bg-edge/8" />

        {/* ── Account module ── */}
        <div className="flex-shrink-0 p-2.5 space-y-1">
          {/* Simulation mode toggle */}
          <div
            className={cn(
              "flex items-center rounded-lg mb-2 transition-all duration-200",
              collapsed
                ? "justify-center py-1.5 mx-auto w-10 bg-[#0EA5E9]/[0.06] border border-[#0EA5E9]/10"
                : "gap-2.5 px-3 py-2 bg-[#0EA5E9]/[0.06] border border-[#0EA5E9]/10",
            )}
            title="Simulation Mode — Trading with virtual money"
          >
            <FlaskConical className="w-[18px] h-[18px] flex-shrink-0 text-[#0EA5E9]" />
            {!collapsed && (
              <div className="min-w-0 flex items-center justify-between flex-1">
                <div>
                  <p className="text-[11px] font-semibold text-[#0EA5E9] leading-tight">Simulation</p>
                  <p className="text-[10px] text-[#0EA5E9]/60 leading-tight">Virtual Money</p>
                </div>
                <div className="w-2 h-2 rounded-full bg-[#0EA5E9] animate-pulse" />
              </div>
            )}
          </div>

          {user && (
            <Tooltip content={`${user.full_name || user.username}`} position="right" delay={200}>
              <div
                className={cn(
                  "flex items-center rounded-lg mb-1 transition-all duration-200",
                  collapsed
                    ? "justify-center py-1.5 mx-auto w-10"
                    : "gap-2.5 px-3 py-2.5 hover:bg-overlay/[0.03]",
                )}
              >
                <UserAvatar user={user} size={8} />
                {!collapsed && (
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-heading truncate leading-tight">
                      {user.full_name || user.username}
                    </p>
                    <p className="text-[11px] text-gray-500 truncate leading-tight mt-0.5">
                      {user.email}
                    </p>
                  </div>
                )}
              </div>
            </Tooltip>
          )}

          {/* Logout */}
          <button
            onClick={handleLogout}
            title={collapsed ? "Log Out" : undefined}
            className={cn(
              "flex items-center h-10 rounded-md transition-all duration-200",
              "text-slate-500 dark:text-slate-400 hover:text-red-500 hover:bg-red-500/[0.06]",
              collapsed ? "justify-center w-10 mx-auto" : "gap-3 px-3 w-full",
            )}
          >
            <LogOut className="w-[18px] h-[18px] flex-shrink-0" />
            {!collapsed && (
              <span className="text-[13px] font-medium whitespace-nowrap">
                Log Out
              </span>
            )}
          </button>
        </div>
      </aside>
    </>
  );
}
