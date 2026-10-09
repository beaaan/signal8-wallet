"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Overview" },
  { href: "/plan", label: "Plan" },
  { href: "/arena", label: "Arena" },
];

export default function Nav() {
  const path = usePathname();
  return (
    <nav aria-label="Main">
      {LINKS.map((l) => {
        const active = l.href === "/" ? path === "/" : path.startsWith(l.href);
        return (
          <Link key={l.href} href={l.href} className={active ? "nav-active" : undefined} aria-current={active ? "page" : undefined}>
            {l.label}
          </Link>
        );
      })}
    </nav>
  );
}
