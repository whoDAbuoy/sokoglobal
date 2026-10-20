import { templateCsv } from '@/lib/catalog-import';

/** GET /supplier/products/import/template → example CSV with every supported column. */
export function GET() {
  return new Response(templateCsv(), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="sokoglobal-listings-template.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
