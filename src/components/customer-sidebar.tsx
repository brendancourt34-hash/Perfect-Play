import Link from "next/link";
import { Home, Trophy, Tag, Wallet2, Menu, LifeBuoy, ShieldCheck, FileText } from "lucide-react";
import { PPMark } from "./pp-mark";

/**
 * The permanent desktop left sidebar for the home page's redesign (approved
 * desktop reference, "Perfect Play" account area). Scoped to the home page only for now —
 * "Competitions"/"My Entries"/"Wallet" link to the closest real existing destination
 * (there's no unified web page for those yet outside the mobile app); nothing here is
 * fabricated, every link goes somewhere real.
 */
export function CustomerSidebar() {
  return (
    <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col border-r border-border bg-surface px-4 py-6 lg:flex">
      <Link href="/" className="flex items-center gap-2 px-2">
        <PPMark className="h-8 w-8 rounded-md" />
        <span className="text-sm font-bold tracking-wide">
          PERFECT <span className="text-brand">PLAY</span>
        </span>
      </Link>

      <nav className="mt-8 flex flex-col gap-1">
        <SidebarLink href="/" icon={Home} label="Home" active />
        <SidebarLink href="/nrl" icon={Trophy} label="Competitions" />
        <SidebarLink href="/my-entries" icon={Tag} label="My Entries" />
        {/* Wallet/More have no web page yet (only the mobile app has them) — shown as
            real destinations once a web account area exists, not linked to an unrelated
            page in the meantime. */}
        <SidebarLink icon={Wallet2} label="Wallet" />
        <SidebarLink icon={Menu} label="More" />
      </nav>

      <div className="mt-8 rounded-xl border border-border p-4">
        <p className="text-lg font-extrabold uppercase italic leading-tight text-brand">
          Real fans.
          <br />
          Bigger moments.
        </p>
      </div>

      {/* Help & Support / Responsible Gambling have no real web page yet — shown as part
          of the visual system, not linked anywhere until real content exists. Terms &
          Conditions now has a real page (src/app/terms/page.tsx). */}
      <div className="mt-auto flex flex-col gap-1 pt-8">
        <SidebarFootLink icon={LifeBuoy} label="Help & Support" />
        <SidebarFootLink icon={ShieldCheck} label="Responsible Gambling" />
        <SidebarFootLink href="/terms" icon={FileText} label="Terms & Conditions" />
      </div>
    </aside>
  );
}

function SidebarLink({
  href,
  icon: IconComponent,
  label,
  active,
}: {
  href?: string;
  icon: typeof Home;
  label: string;
  active?: boolean;
}) {
  const content = (
    <>
      <IconComponent className="h-[18px] w-[18px]" strokeWidth={1.75} />
      {label}
    </>
  );

  if (!href) {
    return (
      <span className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-2 opacity-60">
        {content}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={
        active
          ? "flex items-center gap-3 rounded-lg bg-brand-soft px-3 py-2.5 text-sm font-semibold text-brand"
          : "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-surface-raised"
      }
    >
      {content}
    </Link>
  );
}

function SidebarFootLink({ href, icon: IconComponent, label }: { href?: string; icon: typeof Home; label: string }) {
  const content = (
    <>
      <IconComponent className="h-4 w-4" strokeWidth={1.75} />
      {label}
    </>
  );

  if (!href) {
    return (
      <span className="flex cursor-default items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-muted-2 opacity-60">{content}</span>
    );
  }

  return (
    <Link href={href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium text-muted-2 transition-colors hover:text-foreground">
      {content}
    </Link>
  );
}
