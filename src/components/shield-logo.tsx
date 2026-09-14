import { cn } from "@/lib/utils";

export function ShieldLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-5", className)}
      aria-hidden="true"
    >
      <path
        d="M16 3.2 6.5 7.1v8.2c0 6.1 4.1 10.6 9.5 12.5 5.4-1.9 9.5-6.4 9.5-12.5V7.1L16 3.2Z"
        fill="currentColor"
        opacity="0.18"
      />
      <path
        d="M16 4.6 8 7.8v7.3c0 5.2 3.4 9.1 8 10.8 4.6-1.7 8-5.6 8-10.8V7.8L16 4.6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M12.2 16.1 14.8 18.7 20.1 13.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
