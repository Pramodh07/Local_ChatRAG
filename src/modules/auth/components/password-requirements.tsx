import { Check, X } from "@/modules/shared/components/icons";
import { cn } from "@/modules/shared/lib/utils";
import { getPasswordRequirements } from "@/modules/auth/validation";

type PasswordRequirementsProps = {
  id?: string;
  password: string;
  size?: "compact" | "default";
  className?: string;
};

export function PasswordRequirements({
  id,
  password,
  size = "default",
  className,
}: PasswordRequirementsProps) {
  const hasInput = password.length > 0;
  const iconSize = size === "compact" ? 10 : 12;

  return (
    <ul
      id={id}
      className={cn(
        "grid grid-cols-2",
        size === "compact" ? "gap-1 pt-1.5" : "mt-3 gap-1.5",
        className,
      )}
      aria-live="polite"
      aria-label="Password requirements"
    >
      {getPasswordRequirements(password).map((requirement) => (
        <li
          key={requirement.label}
          className={cn(
            "flex items-center gap-1.5 rounded-md border font-normal transition-colors duration-150",
            size === "compact"
              ? "px-2 py-1 text-[10px]"
              : "rounded-lg px-2.5 py-1.5 text-[11px]",
            requirement.valid
              ? "border-ok/30 bg-ok/10 text-ok"
              : hasInput
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-line bg-raised text-muted",
          )}
        >
          {requirement.valid ? (
            <Check size={iconSize} className="shrink-0" />
          ) : hasInput ? (
            <X size={iconSize} className="shrink-0" />
          ) : (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-50" />
          )}
          <span className="truncate">{requirement.label}</span>
        </li>
      ))}
    </ul>
  );
}
