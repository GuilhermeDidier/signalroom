import { redirect } from "next/navigation";

export default async function TenantIndex({ params }: PageProps<"/app/[slug]">) {
  const { slug } = await params;
  redirect(`/app/${slug}/overview`);
}
