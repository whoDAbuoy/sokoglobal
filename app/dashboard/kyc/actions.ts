'use server';

import { revalidatePath } from 'next/cache';
import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { friendlyError } from '@/lib/format';
import { UUID_RE } from '@/lib/uploads';
import { isKycDocumentType, normalizeDocumentNumber, type KycDocumentType } from '@/lib/kyc';

export type KycResult = { ok: boolean; message: string };
const BUCKET = 'kyc-documents';
const OWN_PATH = (uid: string) => new RegExp(`^${uid}/verification/[0-9a-f-]{36}\\.(pdf|jpg|png)$`);

/** Removes a file from the user's verification folder (the browser may not delete submitted evidence). */
async function removeOwnFile(uid: string, path: string) {
  if (!OWN_PATH(uid).test(path)) return;
  try { await createAdminClient().storage.from(BUCKET).remove([path]); } catch { /* best effort */ }
}

/**
 * Submit one uploaded document for review. submit_kyc_verification() re-checks that the
 * file exists in the caller's own folder and recomputes profiles.kyc_status.
 */
export async function submitKycDocument(documentType: KycDocumentType, documentNumber: string, path: string): Promise<KycResult> {
  const { supabase, user } = await getSessionProfile();
  if (!user) return { ok: false, message: 'Sign in first.' };
  if (!isKycDocumentType(documentType)) return { ok: false, message: 'Choose a document type.' };
  const number = normalizeDocumentNumber(documentNumber);
  if (!number) return { ok: false, message: 'Enter the document number as printed (3–40 letters or digits).' };
  if (!OWN_PATH(user.id).test(path)) return { ok: false, message: 'Upload the document again.' };
  const { error } = await supabase.rpc('submit_kyc_verification', { p_document_type: documentType, p_document_number: number, p_document_url: path });
  if (error) {
    await removeOwnFile(user.id, path);
    return { ok: false, message: friendlyError(error.message) };
  }
  revalidatePath('/dashboard/kyc');
  return { ok: true, message: 'Submitted. We usually review documents within one business day.' };
}

export async function withdrawKycDocument(id: string): Promise<KycResult> {
  const { supabase, user } = await getSessionProfile();
  if (!user) return { ok: false, message: 'Sign in first.' };
  if (!UUID_RE.test(id)) return { ok: false, message: 'Invalid document.' };
  const { data: path, error } = await supabase.rpc('withdraw_kyc_verification', { p_id: id });
  if (error) return { ok: false, message: friendlyError(error.message) };
  if (typeof path === 'string') await removeOwnFile(user.id, path);
  revalidatePath('/dashboard/kyc');
  return { ok: true, message: 'Document withdrawn.' };
}
