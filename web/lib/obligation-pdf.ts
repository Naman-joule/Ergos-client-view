// Reads the text of an uploaded obligation report. Server only.
import 'server-only';
import { extractText, getDocumentProxy } from 'unpdf';
import { parseObligationText, type ParsedObligation } from './obligation.ts';

/** Parse an uploaded PDF. A DOR has 2 pages; anything much longer isn't one, so don't spend time on it. */
export async function readObligationPdf(data: Uint8Array, fileName: string): Promise<ParsedObligation | { error: string }> {
  let pdf;
  try {
    pdf = await getDocumentProxy(new Uint8Array(data));   // pdf.js takes ownership of the buffer: give it a copy
  } catch {
    return { error: 'The file could not be opened as a PDF.' };
  }
  try {
    if (pdf.numPages > 10) return { error: `This PDF has ${pdf.numPages} pages; an IEX Daily Obligation Report has 2.` };
    const { text } = await extractText(pdf, { mergePages: false });
    if (!text.join('').trim()) return { error: 'The PDF has no text (a scan?). Upload the report as downloaded from IEX.' };
    return parseObligationText(text[0] ?? '', fileName);
  } finally {
    await pdf.cleanup().catch(() => {});
  }
}
