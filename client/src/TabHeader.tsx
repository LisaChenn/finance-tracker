export type ViewName = "overview" | "accounts" | "spending" | "investments";

interface Props {
  active: ViewName;
  onChange: (next: ViewName) => void;
  right?: React.ReactNode;
}

const TABS: { id: ViewName; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "accounts", label: "Accounts" },
  { id: "spending", label: "Spending" },
  { id: "investments", label: "Investments" },
];

export default function TabHeader({ active, onChange, right }: Props) {
  return (
    <div className="flex items-center justify-between gap-3 px-1 pb-5">
      <div className="flex items-center gap-[22px]">
        {TABS.map((t) => {
          const isActive = active === t.id;
          return (
            <button
              key={t.id}
              onClick={() => onChange(t.id)}
              className={
                isActive
                  ? "text-ink font-semibold text-[14px] leading-none"
                  : "text-ink-faint font-medium text-[13px] leading-none hover:text-ink transition-colors"
              }
            >
              {t.label}
            </button>
          );
        })}
      </div>
      <div className="flex items-center gap-2.5">{right}</div>
    </div>
  );
}
