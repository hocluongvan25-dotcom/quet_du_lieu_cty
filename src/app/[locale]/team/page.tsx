import { notFound } from "next/navigation";
import { TeamPage } from "@/components/team-page";
import { loadWorkspace, loadWorkspaceMembers } from "@/lib/data/workspace";
import { isAppLocale } from "@/lib/i18n";

export default async function TeamRoute({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isAppLocale(locale)) notFound();

  const [workspace, members] = await Promise.all([
    loadWorkspace(locale),
    loadWorkspaceMembers(locale),
  ]);

  const role = workspace.account?.role ?? "member";

  return (
    <TeamPage
      locale={locale}
      members={members.data}
      live={members.available}
      canInvite={members.available && (role === "owner" || role === "admin")}
    />
  );
}
