import { getDashboardData } from "@/lib/dashboard";

export const dynamic = "force-dynamic";

export async function GET() {
  const data = await getDashboardData();
  return Response.json(data, { headers: { "cache-control": "no-store" } });
}
