import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { ArrowLeft, FolderTree, ShieldAlert } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import { isAdmin } from '@/lib/auth/admin-access';
import { buildCategoryTree, flattenTree, parseAttributeSchema, pathLabel, type CategoryRow } from '@/lib/catalog';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import CategoryForm from '@/components/admin/CategoryForm';

export const metadata = { title: 'Categories · SokoGlobal Ops', robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

/** Admin category tree: add sectors and sub-categories, edit attribute fields, pause categories. */
export default async function CategoriesPage() {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user) redirect('/login?redirectTo=/admin/categories');
  if (!isAdmin(profile)) notFound();

  const [{ data, error }, { data: live }] = await Promise.all([
    supabase.from('categories').select('id, parent_id, slug, name, description, icon, sort_order, is_active, attribute_schema, legacy_category, requires_compliance'),
    supabase.from('products').select('category_id').eq('status', 'live').limit(5000),
  ]);
  const rows = (data ?? []) as CategoryRow[];
  const flat = flattenTree(buildCategoryTree(rows));
  const parents = flat.filter((n) => n.depth < 3).map((n) => ({ id: n.id, label: pathLabel(rows, n.id) }));
  const liveCount = new Map<string, number>();
  for (const p of live ?? []) if (p.category_id) liveCount.set(p.category_id, (liveCount.get(p.category_id) ?? 0) + 1);

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-10">
        <Link href="/admin/products" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900"><ArrowLeft className="h-4 w-4" aria-hidden /> Catalogue</Link>
        <h1 className="mt-3 flex items-center gap-2 text-3xl font-semibold text-neutral-900"><FolderTree className="h-7 w-7 text-neutral-500" aria-hidden /> Categories</h1>
        <p className="mt-1 text-sm text-neutral-600">The tree suppliers list under and buyers browse. Every change is written to the audit log.</p>

        {error ? (
          <p role="alert" className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Run <code className="font-mono">supabase/migrations/015_catalog.sql</code> to enable categories.
          </p>
        ) : (
          <>
            <details className="card mt-6 p-5">
              <summary className="cursor-pointer font-semibold text-neutral-900">Add a category</summary>
              <div className="mt-4"><CategoryForm parents={parents} /></div>
            </details>

            <ul className="card mt-6 divide-y divide-neutral-200 overflow-hidden">
              {flat.map((n) => (
                <li key={n.id}>
                  <details>
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-neutral-50" style={{ paddingLeft: `${1.25 + n.depth * 1.5}rem` }}>
                      <span className="min-w-0">
                        <span className="font-medium text-neutral-900">{n.name}</span>
                        <code className="ml-2 font-mono text-xs text-neutral-500">{n.slug}</code>
                      </span>
                      <span className="flex flex-wrap items-center gap-1.5 text-xs">
                        {!n.is_active && <span className="pill tone-muted">Paused</span>}
                        {n.requires_compliance && <span className="pill tone-pending"><ShieldAlert className="h-3 w-3" aria-hidden /> Regulated</span>}
                        {n.legacy_category !== 'general' && <span className="pill tone-active capitalize">{n.legacy_category} rules</span>}
                        <span className="text-neutral-600">{parseAttributeSchema(n.attribute_schema).length} fields · {liveCount.get(n.id) ?? 0} live</span>
                      </span>
                    </summary>
                    <div className="border-t border-neutral-200 bg-neutral-50/60 px-5 py-4">
                      <CategoryForm parents={parents} value={{
                        id: n.id, name: n.name, slug: n.slug, parent_id: n.parent_id, description: n.description ?? null, icon: n.icon ?? null,
                        sort_order: n.sort_order, is_active: n.is_active, requires_compliance: n.requires_compliance, legacy_category: n.legacy_category,
                        attribute_schema: n.attribute_schema,
                      }} />
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          </>
        )}
      </main>
    </>
  );
}
