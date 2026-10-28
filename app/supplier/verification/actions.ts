'use server';

import { getSessionProfile } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { friendlyError } from '@/lib/format';
import { mimeFromPath } from '@/lib/file-signature';
import { storedFileMatches } from '@/lib/storage-sniff-server';
import { Constants, type Database } from '@/lib/supabase/database.types';

type DocType = Database['public']['Enums']['kyc_doc_type'];
export type KycDocumentRow = { id: string; doc_type: DocType; file_name: string; storage_path: string; uploaded_at: string };
export type AddKycDocumentResult = { ok: true; document: KycDocumentRow } | { ok: false; message: string };

const BUCKET = 'kyc-documents';
const MAX_BYTES = 10 * 1024 * 1024;
const isDocType = (v: string): v is DocType => (Constants.public.Enums.kyc_doc_type as readonly string[]).includes(v);

/**
 * Records one supplier KYC document after the browser has uploaded it to its own kyc-documents folder.
 * The bytes must really be the PDF / JPG / PNG the name claims. Migration 042 took the browser's INSERT
 * away, so this repeats what the old "kyc_docs: supplier adds own" policy checked (a supplier, their own
 * folder, verification not yet submitted or approved) and writes the row with the service role.
 */
export async function addKycDocument(docType: string, path: string, fileName: string): Promise<AddKycDocumentResult> {
  const { supabase, user, profile } = await getSessionProfile();
  if (!user || profile?.role !== 'supplier') return { ok: false, message: 'Sign in with your supplier account.' };
  if (!isDocType(docType)) return { ok: false, message: 'Choose a document type.' };
  const folder = `${user.id}/${docType}`;
  const file = path.slice(folder.length + 1);
  if (!path.startsWith(`${folder}/`) || !/^[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(file)) return { ok: false, message: 'Upload the document again.' };

  const admin = createAdminClient();
  const discard = () => admin.storage.from(BUCKET).remove([path]).catch(() => undefined);

  const { data: kyc } = await supabase.from('supplier_kyc').select('status').eq('supplier_id', user.id).maybeSingle();
  if (kyc && (kyc.status === 'submitted' || kyc.status === 'approved')) {
    await discard();
    return { ok: false, message: 'Your verification is already submitted. Ask support to reopen it before adding documents.' };
  }
  const { data: listed } = await admin.storage.from(BUCKET).list(folder, { search: file, limit: 1 });
  const bytes = Number(listed?.find((o) => o.name === file)?.metadata?.size ?? 0);
  if (bytes <= 0) return { ok: false, message: 'Upload the document again.' };
  if (bytes > MAX_BYTES) { await discard(); return { ok: false, message: 'File is larger than 10 MB.' }; }
  const mime = mimeFromPath(path)!;
  if (!(await storedFileMatches(BUCKET, path, mime))) {
    await discard();
    return { ok: false, message: "That file isn't a readable PDF, JPG or PNG. Scan or photograph the document again and upload it." };
  }

  const { data, error } = await admin.from('kyc_documents')
    .insert({ supplier_id: user.id, doc_type: docType, storage_path: path, file_name: fileName.slice(0, 255) || file, mime_type: mime, bytes })
    .select('id, doc_type, file_name, storage_path, uploaded_at').single();
  if (error || !data) { await discard(); return { ok: false, message: friendlyError(error?.message) }; }
  return { ok: true, document: data };
}
