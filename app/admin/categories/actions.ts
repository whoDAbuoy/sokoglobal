'use server';

import { revalidatePath, revalidateTag } from 'next/cache';
import { PUBLIC_CATALOG_TAG } from '@/lib/public-catalog';
import { revalidateCategories } from '@/lib/categories-server';
import { getSessionProfile } from '@/lib/supabase/server';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { isAdmin } from '@/lib/auth/admin-access';
import { slugify, validateAttributeSchemaJson } from '@/lib/catalog';

export type CategoryState = { ok: boolean; message: string } | null;

/**
 * Create or update a category. Runs with the admin's own session: the
 * "categories: admin writes" RLS policy re-checks admin access, the tree
 * trigger blocks cycles / depth > 4, and every write is audited by trigger.
 */
export async function saveCategory(_prev: CategoryState, form: FormData): Promise<CategoryState> {
  const ctx = await getSessionProfile();
  if (!ctx.user || !isAdmin(ctx.profile)) return { ok: false, message: 'Admin access required.' };

  const id = String(form.get('id') ?? '');
  const name = String(form.get('name') ?? '').trim().replace(/\s+/g, ' ');
  const slug = slugify(String(form.get('slug') ?? '') || name);
  const parent = String(form.get('parent_id') ?? '');
  const legacy = String(form.get('legacy_category') ?? 'general');
  const sort = Number.parseInt(String(form.get('sort_order') ?? '0'), 10);
  if (name.length < 2 || name.length > 80) return { ok: false, message: 'Name must be 2–80 characters.' };
  if (!slug) return { ok: false, message: 'Give the category a URL slug.' };
  if (parent && !UUID_RE.test(parent)) return { ok: false, message: 'Invalid parent.' };
  if (id && parent === id) return { ok: false, message: 'A category cannot be its own parent.' };
  if (!['beauty', 'clothing', 'general'].includes(legacy)) return { ok: false, message: 'Invalid listing rules.' };
  const schema = validateAttributeSchemaJson(String(form.get('attribute_schema') ?? '[]'));
  if (!schema.ok) return { ok: false, message: schema.error };

  const row = {
    name, slug, parent_id: parent || null, legacy_category: legacy,
    description: String(form.get('description') ?? '').trim().slice(0, 500) || null,
    icon: String(form.get('icon') ?? '').trim().slice(0, 40) || null,
    sort_order: Number.isFinite(sort) ? Math.max(-1000, Math.min(1000, sort)) : 0,
    is_active: form.get('is_active') === 'on',
    requires_compliance: form.get('requires_compliance') === 'on',
    attribute_schema: schema.schema,
  };
  const { error } = id
    ? (UUID_RE.test(id) ? await ctx.supabase.from('categories').update(row).eq('id', id) : { error: { message: 'Invalid category.' } })
    : await ctx.supabase.from('categories').insert(row);
  if (error) return { ok: false, message: /categories_slug_key|duplicate/.test(error.message) ? `The slug "${slug}" is already used.` : friendlyError(error.message) };
  revalidatePath('/admin/categories');
  revalidatePath('/dashboard/discover');
  revalidateTag(PUBLIC_CATALOG_TAG);   // category names on the public pages
  revalidateCategories();
  return { ok: true, message: id ? `Saved ${name}.` : `Created ${name}.` };
}
