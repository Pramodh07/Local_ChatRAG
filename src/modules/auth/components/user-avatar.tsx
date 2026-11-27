"use client";

import { memo, useEffect, useState } from "react";
import { cn } from "@/modules/shared/lib/utils";

type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

export type UserAvatarProps = {
  avatarUrl?: string | null;
  displayName?: string | null;
  email?: string | null;
  size?: AvatarSize;
  className?: string;
};

const sizeStyles: Record<AvatarSize, { container: string; text: string }> = {
  xs: { container: "h-6 w-6", text: "text-[10px]" },
  sm: { container: "h-8 w-8", text: "text-xs" },
  md: { container: "h-10 w-10", text: "text-sm" },
  lg: { container: "h-14 w-14", text: "text-lg" },
  xl: { container: "h-20 w-20", text: "text-2xl" },
};

export const UserAvatar = memo(function UserAvatar({
  avatarUrl,
  displayName,
  email,
  size = "sm",
  className,
}: UserAvatarProps) {
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    setImageError(false);
  }, [avatarUrl]);

  const initial =
    displayName?.trim().slice(0, 1).toUpperCase() ||
    email?.trim().slice(0, 1).toUpperCase() ||
    "A";

  const { container, text } = sizeStyles[size];

  if (avatarUrl && !imageError) {
    return (
      <img
        src={avatarUrl}
        alt={displayName || "User avatar"}
        onError={() => setImageError(true)}
        className={cn(
          "rounded-full object-cover shrink-0 select-none bg-raised border border-line/60",
          container,
          className,
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-accent-soft font-semibold text-accent-ink select-none",
        container,
        text,
        className,
      )}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
});
