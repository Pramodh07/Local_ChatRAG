import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/modules/shared/lib/utils";

export function NavItem({
  href,
  icon,
  active = false,
  children,
  onClick,
  className,
}: {
  href: string;
  icon?: ReactNode;
  active?: boolean;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
      className={cn(
        "group flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13px] transition-colors duration-150",
        active
          ? "bg-accent-soft font-medium text-accent-ink"
          : "text-muted hover:bg-raised hover:text-ink",
        className,
      )}
    >
      {icon && <span className="shrink-0 opacity-80">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </Link>
  );
}
