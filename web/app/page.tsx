import { getDashboardData } from "@/lib/dashboard";
import Dashboard from "./Dashboard";

export const dynamic = "force-dynamic";

export default async function Home({ searchParams }: { searchParams: Promise<{ big?: string | string[] }> }) {
  const [initial, sp] = await Promise.all([getDashboardData(), searchParams]);
  return <Dashboard initial={initial} big={sp.big === "1"} />;
}
