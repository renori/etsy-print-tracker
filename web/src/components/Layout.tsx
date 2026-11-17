import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Icon, IconButton, type IconName } from "./ui";

interface NavItem {
  to: string;
  label: string;
  icon?: IconName;
}

const GROUPS: { title: string; items: NavItem[] }[] = [
  {
    title: "Daily",
    items: [
      { to: "/", label: "Home", icon: "home" },
      { to: "/queue", label: "Print Queue", icon: "printer" },
      { to: "/orders", label: "Active Orders", icon: "orders" },
      { to: "/stock", label: "Printed Stock", icon: "stock" },
      { to: "/boxes", label: "Shipping Boxes", icon: "box" },
    ],
  },
  {
    title: "Records",
    items: [
      { to: "/completed", label: "Completed Orders", icon: "check" },
      { to: "/replacements", label: "Replacements", icon: "refresh" },
      { to: "/expenses", label: "Expenses", icon: "receipt" },
      { to: "/mileage", label: "Mileage Log", icon: "car" },
      { to: "/ledger", label: "Etsy Ledger", icon: "dollar" },
    ],
  },
  {
    title: "Setup",
    items: [
      { to: "/parts", label: "Parts Catalog" },
      { to: "/listing-map", label: "Listing Map" },
      { to: "/plate-recipes", label: "Plate Recipes" },
      { to: "/printers", label: "Printers" },
      { to: "/blackout", label: "Schedule & Blackouts" },
      { to: "/etsy", label: "Etsy Connection" },
      { to: "/import", label: "Import from Sheet", icon: "upload" },
    ],
  },
];

const ALL = GROUPS.flatMap((g) => g.items);
const TABS = ["/", "/queue", "/orders", "/stock"].map((to) => ALL.find((i) => i.to === to)!);

const isActive = (to: string, path: string) => (to === "/" ? path === "/" : path === to || path.startsWith(to + "/"));

function SideNav({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="space-y-5">
      {GROUPS.map((g) => (
        <div key={g.title}>
          <div className="mb-1 px-3 text-xs font-semibold tracking-wide text-neutral-500 uppercase">{g.title}</div>
          <div className="space-y-0.5">
            {g.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === "/"}
                onClick={onNavigate}
                className={({ isActive: on }) =>
                  `flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] md:min-h-9 md:text-sm ${
                    on
                      ? "bg-indigo-600 font-medium text-white"
                      : "text-neutral-700 hover:bg-neutral-100 active:bg-neutral-200 dark:text-neutral-300 dark:hover:bg-neutral-800"
                  }`
                }
              >
                <span className="flex w-5 justify-center">{item.icon && <Icon name={item.icon} className="h-[18px] w-[18px]" />}</span>
                {item.label}
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

export function Layout() {
  const [moreOpen, setMoreOpen] = useState(false);
  const { pathname } = useLocation();
  const current = ALL.find((n) => isActive(n.to, pathname));
  const inTabs = TABS.some((t) => isActive(t.to, pathname));

  useEffect(() => {
    setMoreOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <div className="min-h-dvh md:flex">
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white px-3 py-5 md:block dark:border-neutral-800 dark:bg-neutral-900">
        <div className="mb-6 flex items-center gap-2.5 px-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <Icon name="printer" className="h-[18px] w-[18px]" />
          </span>
          <span className="text-lg font-bold">Print Tracker</span>
        </div>
        <SideNav />
      </aside>

      {/* Phone top bar */}
      <header className="pt-safe sticky top-0 z-30 border-b border-neutral-200 bg-white/90 backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-900/90">
        <div className="flex h-12 items-center justify-center px-4">
          <span className="truncate font-semibold">{current?.label ?? "Print Tracker"}</span>
        </div>
      </header>

      <main className="min-w-0 flex-1 px-4 pt-4 pb-28 md:px-8 md:pt-6 md:pb-10">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>

      {/* Phone bottom tabs */}
      <nav
        aria-label="Quick"
        className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-neutral-200 bg-white/95 backdrop-blur md:hidden dark:border-neutral-800 dark:bg-neutral-900/95"
      >
        <div className="grid grid-cols-5">
          {TABS.map((t) => {
            const on = isActive(t.to, pathname);
            return (
              <NavLink
                key={t.to}
                to={t.to}
                end={t.to === "/"}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${on ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-500"}`}
              >
                <Icon name={t.icon!} className="h-6 w-6" />
                {t.label.replace("Active ", "").replace("Printed ", "").replace("Print ", "")}
              </NavLink>
            );
          })}
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-expanded={moreOpen}
            className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${!inTabs ? "text-indigo-600 dark:text-indigo-400" : "text-neutral-500"}`}
          >
            <Icon name="menu" className="h-6 w-6" />
            More
          </button>
        </div>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-40 flex items-end md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="animate-fade-in absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} aria-hidden="true" />
          <div className="animate-sheet-up pb-safe relative max-h-[85dvh] w-full overflow-y-auto rounded-t-2xl bg-white px-3 pt-2 pb-6 shadow-2xl dark:bg-neutral-900">
            <div className="mx-auto mb-1 h-1.5 w-10 rounded-full bg-neutral-300 dark:bg-neutral-700" aria-hidden="true" />
            <div className="mb-2 flex items-center justify-between px-3">
              <span className="text-lg font-semibold">Menu</span>
              <IconButton icon="x" label="Close menu" onClick={() => setMoreOpen(false)} className="-mr-2" />
            </div>
            <SideNav onNavigate={() => setMoreOpen(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
