"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navItems = [
  { href: "/dashboard", label: "Resumen", exact: true },
  { href: "/dashboard/expenses", label: "Gastos", exact: false }
];

export default function DashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 text-sm font-medium">
      {navItems.map((item) => {
        const isActive = item.exact ? pathname === item.href : pathname?.startsWith(item.href);

        return (
          <Link
            key={item.href}
            className={`rounded-t px-3 py-1.5 text-slate-700 transition-all duration-200 hover:bg-slate-100 ${
              isActive ? "border-b-2 border-slate-900 text-slate-900" : "border-b-2 border-transparent"
            }`}
            href={item.href}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
