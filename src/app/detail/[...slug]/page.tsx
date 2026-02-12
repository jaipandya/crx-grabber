import { redirect } from "next/navigation";

export default async function DetailCatchAll({
  params,
}: {
  params: Promise<{ slug: string[] }>;
}) {
  const { slug } = await params;

  // Reject absurdly long paths (DoS / log spam)
  if (slug.length > 10) {
    redirect("/");
  }

  // Expected patterns: /detail/extension-name/EXTENSION_ID or /detail/EXTENSION_ID
  let id: string | null = null;
  let name: string | null = null;

  if (slug.length >= 2) {
    const candidate = slug[slug.length - 1];
    if (/^[a-z]{32}$/i.test(candidate)) {
      id = candidate.toLowerCase();
      // Sanitize name: only keep alphanumeric, spaces, hyphens; truncate
      const rawName = slug[slug.length - 2].replace(/-/g, " ");
      name = rawName.replace(/[^a-zA-Z0-9 ]/g, "").slice(0, 80);
    }
  } else if (slug.length === 1 && /^[a-z]{32}$/i.test(slug[0])) {
    id = slug[0].toLowerCase();
  }

  if (id) {
    const searchParams = new URLSearchParams({ id });
    if (name) searchParams.set("name", name);
    redirect(`/?${searchParams.toString()}`);
  }

  redirect("/");
}
