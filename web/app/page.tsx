import { getDashboardData } from "@/lib/dashboard";
import Dashboard from "./Dashboard";

export const dynamic = "force-dynamic";

export default async function Home() {
  const initial = await getDashboardData();
  return <Dashboard initial={initial} />;
}
