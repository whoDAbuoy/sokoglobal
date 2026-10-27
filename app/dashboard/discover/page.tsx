import Link from 'next/link';
import { redirect } from 'next/navigation';
import clsx from 'clsx';
import { ChevronRight, Compass, Search, SlidersHorizontal, X } from 'lucide-react';
import { getSessionProfile } from '@/lib/supabase/server';
import {
  CATALOG_PAGE_SIZE, CATALOG_SORTS, buildCategoryTree, catalogHref, categoryPath, computeFacets, descendantIds, effectiveSchema,
  matchesFilters, parseCatalogQuery, sortListings, toggleFilter, type CatalogQuery, type CategoryNode, type CategoryRow,
} from '@/lib/catalog';
import { CATALOG_PRODUCT_SELECT, toTrialProductView, type CatalogProductRow } from '@/lib/product-view';
import { goldSupplierIds } from '@/lib/pricing-server';
import { getCategories } from '@/lib/categories-server';
import DashboardHeader from '@/components/dashboard/DashboardHeader';
import TrialBatchCard from '@/components/dashboard/TrialBatchCard';

export const metadata = { title: 'Catalogue · SokoGlobal' };
export const dynamic = 'force-dynamic';

/** Upper bound of live listings scanned per category view; facets and filters run over this set. */
const SCAN_LIMIT = 500;

const SELECT = CATALOG_PRODUCT_SELECT;

/**
 * Buyer catalogue for every commodity: category tree, full-text search, and
 * filters built from each category's attribute schema (Purity grade, Harvest
 * year, Certifications…). Reads only live listings, through RLS.
 */
export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Session, query string and the (cross-request cached) category tree are independent: load them together.
  const [{ supabase, user, profile }, params, catData] = await Promise.all([getSessionProfile(), searchParams, getCategories()]);
  if (!user || !profile) redirect('/login?redirectTo=/dashboard/discover');
  if (profile.role === 'supplier') redirect('/supplier');

  const query = parseCatalogQuery(params);
  if (!catData) {
    return (
      <>
        <DashboardHeader profile={profile} />
        <main className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <h1 className="text-2xl font-semibold text-neutral-900">The full catalogue is on its way</h1>
          <p className="mt-2 text-sm text-neutral-600">Browse current Trial Batches on your dashboard in the meantime.</p>
          <Link href="/dashboard#batches" className="btn-primary mt-6 inline-flex">Back to Discover</Link>
        </main>
      </>
    );
  }

  const categories: CategoryRow[] = catData;
  const tree = buildCategoryTree(categories);
  const current = query.category ? categories.find((c) => c.slug === query.category) ?? null : null;
  const trail = current ? categoryPath(categories, current.id) : [];
  const scope = current ? descendantIds(categories, current.id) : null;

  let dbq = supabase.from('products').select(SELECT).eq('status', 'live').is('deleted_at', null).order('created_at', { ascending: false }).limit(SCAN_LIMIT);
  if (scope) dbq = dbq.in('category_id', scope);
  if (query.q) dbq = dbq.textSearch('search_tsv', query.q, { type: 'websearch', config: 'simple' });
  const { data, error } = await dbq;
  if (error) throw new Error(`Could not load the catalogue: ${error.message}`);

  const rows = (data ?? []) as unknown as CatalogProductRow[];
  const nameById = new Map(categories.map((c) => [c.id, c.name]));
  const schema = effectiveSchema(categories, current?.id);
  const facets = computeFacets(schema, rows);
  const filtered = rows.filter((r) => matchesFilters(r.attributes, query.filters, query.ranges));
  const sorted = sortListings(filtered.map((r) => ({ ...r, landed_cost_cents: r.trial_landed_cost_cents })), query.sort);
  const pages = Math.max(1, Math.ceil(sorted.length / CATALOG_PAGE_SIZE));
  const page = Math.min(query.page, pages);
  const pageRows = sorted.slice((page - 1) * CATALOG_PAGE_SIZE, page * CATALOG_PAGE_SIZE);
  const gold = await goldSupplierIds(supabase, pageRows.map((r) => r.supplier_id));
  const shown = pageRows.map((r) => toTrialProductView(r, r.category_id ? nameById.get(r.category_id) ?? null : null, gold));

  // Listing counts per child category (from the scanned set).
  const children: CategoryNode[] = current ? findNode(tree, current.id)?.children ?? [] : tree;
  const countIn = (node: CategoryNode) => {
    const ids = new Set(descendantIds(categories, node.id));
    return rows.filter((r) => r.category_id && ids.has(r.category_id)).length;
  };
  const activeFilters = Object.entries(query.filters).flatMap(([k, vs]) => vs.map((v) => ({ k, v })));
  const label = (k: string) => schema.find((f) => f.key === k)?.label ?? k.replace(/_/g, ' ');
  const href = (patch: Partial<CatalogQuery>) => catalogHref({ ...query, page: 1, ...patch });

  return (
    <>
      <DashboardHeader profile={profile} />
      <main className="page-wide py-10">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-neutral-600">
          <Link href={href({ category: null, filters: {}, ranges: {} })} className="hover:text-neutral-900">All categories</Link>
          {trail.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1">
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              <Link href={href({ category: c.slug, filters: {}, ranges: {} })} aria-current={c.id === current?.id ? 'page' : undefined}
                className={c.id === current?.id ? 'font-medium text-neutral-900' : 'hover:text-neutral-900'}>{c.name}</Link>
            </span>
          ))}
        </nav>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-3xl font-semibold text-neutral-900"><Compass className="h-7 w-7 text-neutral-500" aria-hidden /> {current?.name ?? 'Catalogue'}</h1>
            <p className="mt-1 max-w-2xl text-sm text-neutral-600">{current?.description ?? 'Every commodity from KYC-verified suppliers, with a Guaranteed Landed Cost and escrow on every order.'}</p>
          </div>
          <form role="search" action="/dashboard/discover" className="flex w-full max-w-md gap-2">
            {current && <input type="hidden" name="category" value={current.slug} />}
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
              <input name="q" defaultValue={query.q} placeholder="Search products, brands, SKUs" aria-label="Search the catalogue" className="input pl-9" />
            </div>
            <button className="btn-primary px-4">Search</button>
          </form>
        </div>

        {children.length > 0 && (
          <ul className="mt-6 flex flex-wrap gap-2" aria-label="Categories">
            {children.map((c) => (
              <li key={c.id}>
                <Link href={href({ category: c.slug, filters: {}, ranges: {} })}
                  className="press inline-flex items-center gap-1.5 rounded-full border border-neutral-300 px-3.5 py-1.5 text-sm text-neutral-800 hover:border-neutral-900">
                  {c.name} <span className="tabular-nums text-xs text-neutral-500">{countIn(c)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-8 grid gap-8 lg:grid-cols-[16rem_minmax(0,1fr)]">
          <aside aria-label="Filters" className="space-y-6">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-neutral-900"><SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters</h2>
            {facets.length === 0 && <p className="text-xs text-neutral-600">{current ? 'No filters for this category yet.' : 'Pick a category to filter by its specifications.'}</p>}
            {facets.map((f) => (
              <section key={f.field.key} aria-labelledby={`facet-${f.field.key}`}>
                <h3 id={`facet-${f.field.key}`} className="label">{f.field.label}{f.field.unit ? ` (${f.field.unit})` : ''}</h3>
                {f.range ? (
                  <form action="/dashboard/discover" className="flex items-center gap-2">
                    <HiddenQuery query={query} omitRange={f.field.key} />
                    <input name={`min.${f.field.key}`} aria-label={`Minimum ${f.field.label}`} inputMode="decimal" defaultValue={query.ranges[f.field.key]?.min} placeholder={String(f.range.min)} className="input px-2 py-1.5 text-xs tabular-nums" />
                    <span className="text-xs text-neutral-500">to</span>
                    <input name={`max.${f.field.key}`} aria-label={`Maximum ${f.field.label}`} inputMode="decimal" defaultValue={query.ranges[f.field.key]?.max} placeholder={String(f.range.max)} className="input px-2 py-1.5 text-xs tabular-nums" />
                    <button className="btn-secondary px-2 py-1.5 text-xs">Go</button>
                  </form>
                ) : (
                  <ul className="space-y-1">
                    {f.values.map(({ value, count }) => {
                      const on = query.filters[f.field.key]?.some((v) => v.toLowerCase() === value.toLowerCase()) ?? false;
                      return (
                        <li key={value}>
                          <Link href={catalogHref(toggleFilter(query, f.field.key, value))} scroll={false}
                            className={clsx('flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm', on ? 'bg-neutral-900 text-white' : 'text-neutral-800 hover:bg-neutral-100')}>
                            <span className="flex items-center gap-2">
                              <span aria-hidden className={clsx('grid h-3.5 w-3.5 place-items-center rounded border', on ? 'border-snow bg-snow' : 'border-neutral-400')}>
                                {on && <span className="h-1.5 w-1.5 rounded-sm bg-neutral-900" />}
                              </span>
                              {value}{on && <span className="sr-only"> (selected, select to remove)</span>}
                            </span>
                            <span className={clsx('text-xs tabular-nums', on ? 'text-white' : 'text-neutral-500')}>{count}</span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            ))}
          </aside>

          <section aria-labelledby="results">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 pb-3">
              <h2 id="results" className="text-sm text-neutral-700" aria-live="polite">
                <strong className="tabular-nums text-neutral-900">{filtered.length.toLocaleString('en-US')}</strong> listing{filtered.length === 1 ? '' : 's'}
                {query.q && <> for &ldquo;{query.q}&rdquo;</>}
                {rows.length === SCAN_LIMIT && <span className="text-neutral-500"> (newest {SCAN_LIMIT} searched; narrow the category for more)</span>}
              </h2>
              <nav aria-label="Sort" className="flex flex-wrap gap-1.5">
                {CATALOG_SORTS.map(([s, l]) => (
                  <Link key={s} href={href({ sort: s })} aria-current={query.sort === s ? 'true' : undefined}
                    className={clsx('rounded-full border px-2.5 py-1 text-xs font-medium', query.sort === s ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300 text-neutral-700 hover:border-neutral-900')}>
                    {l}
                  </Link>
                ))}
              </nav>
            </div>

            {(activeFilters.length > 0 || Object.keys(query.ranges).length > 0) && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {activeFilters.map(({ k, v }) => (
                  <Link key={`${k}:${v}`} href={catalogHref(toggleFilter(query, k, v))} className="pill border-neutral-300 text-neutral-800 hover:border-neutral-900">
                    {label(k)}: {v} <X className="h-3 w-3" aria-label="Remove filter" />
                  </Link>
                ))}
                {Object.entries(query.ranges).map(([k, r]) => (
                  <Link key={k} href={href({ ranges: Object.fromEntries(Object.entries(query.ranges).filter(([x]) => x !== k)) })} className="pill border-neutral-300 text-neutral-800 hover:border-neutral-900">
                    {label(k)}: {r.min ?? '…'}–{r.max ?? '…'} <X className="h-3 w-3" aria-label="Remove filter" />
                  </Link>
                ))}
                <Link href={href({ filters: {}, ranges: {} })} className="text-xs font-medium text-blue-700 hover:underline dark:text-cyan-300">Clear all</Link>
              </div>
            )}

            {shown.length === 0 ? (
              <div className="card mt-6 px-6 py-14 text-center">
                <p className="font-medium text-neutral-900">No listings match yet.</p>
                <p className="mt-1 text-sm text-neutral-600">Try fewer filters, a broader category, or a different search.</p>
              </div>
            ) : (
              <div className="mt-6 grid gap-x-6 gap-y-12 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {shown.map((p) => <TrialBatchCard key={p.id} product={p} />)}
              </div>
            )}

            {pages > 1 && (
              <nav aria-label="Pages" className="mt-10 flex items-center justify-center gap-2 text-sm">
                {page > 1 && <Link href={catalogHref({ ...query, page: page - 1 })} className="btn-secondary px-3 py-1.5">Previous</Link>}
                <span className="tabular-nums text-neutral-600">Page {page} of {pages}</span>
                {page < pages && <Link href={catalogHref({ ...query, page: page + 1 })} className="btn-secondary px-3 py-1.5">Next</Link>}
              </nav>
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function findNode(nodes: CategoryNode[], id: string): CategoryNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = findNode(n.children, id);
    if (hit) return hit;
  }
  return null;
}

/** Carries the current query through a GET form (category, search, filters, other ranges, sort). */
function HiddenQuery({ query, omitRange }: { query: CatalogQuery; omitRange: string }) {
  return (
    <>
      {query.category && <input type="hidden" name="category" value={query.category} />}
      {query.q && <input type="hidden" name="q" value={query.q} />}
      {query.sort !== 'featured' && <input type="hidden" name="sort" value={query.sort} />}
      {Object.entries(query.filters).flatMap(([k, vs]) => vs.map((v) => <input key={`${k}:${v}`} type="hidden" name={`f.${k}`} value={v} />))}
      {Object.entries(query.ranges).filter(([k]) => k !== omitRange).flatMap(([k, r]) => [
        r.min !== undefined && <input key={`min.${k}`} type="hidden" name={`min.${k}`} value={r.min} />,
        r.max !== undefined && <input key={`max.${k}`} type="hidden" name={`max.${k}`} value={r.max} />,
      ])}
    </>
  );
}
