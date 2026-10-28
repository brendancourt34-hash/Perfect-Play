/** Small bordered day/month chip — e.g. "12" over "AUG" — used on upcoming-competition rows. */
export function DateChip({ date }: { date: Date }) {
  const day = new Intl.DateTimeFormat("en-AU", { day: "numeric", timeZone: "Australia/Sydney" }).format(date);
  const month = new Intl.DateTimeFormat("en-AU", { month: "short", timeZone: "Australia/Sydney" }).format(date).toUpperCase();

  return (
    <div className="flex shrink-0 flex-col items-center rounded-lg border border-border bg-surface-raised px-2.5 py-1.5">
      <span className="text-sm font-extrabold leading-none text-foreground">{day}</span>
      <span className="mt-0.5 text-[9px] font-bold leading-none text-muted-2">{month}</span>
    </div>
  );
}
