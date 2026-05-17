import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  active?: boolean;
  children: ReactNode;
};

export function IconButton({ label, active, className, children, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      title={label}
      className={clsx(
        "grid size-11 place-items-center rounded-full border transition active:scale-95",
        active
          ? "border-blue-soft bg-blue-soft/45 text-ink"
          : "border-transparent bg-transparent text-muted hover:bg-panel/70",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
