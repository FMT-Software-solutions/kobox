import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

/**
 * Getting a report out of the app.
 *
 * Three routes, because groups use three different ones: a WhatsApp message to
 * the group chat, a CSV for whoever keeps the spreadsheet, and a PDF for the
 * file an auditor signs. The share sheet handles delivery in every case, so
 * none of this needs a per-app integration.
 */

/** RFC 4180: quote anything containing a comma, quote or newline; double the quotes. */
function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function toCsv(headers: string[], rows: (string | number | null)[][]): string {
  // A BOM, so Excel opens ₵ and any non-ASCII name as UTF-8 rather than
  // mojibake. Without it a member called "Yaw Owusu-Ansah" is fine but a
  // currency symbol is not, and the treasurer blames the app.
  return (
    '﻿' +
    [headers.map(csvCell).join(','), ...rows.map((row) => row.map(csvCell).join(','))].join('\r\n')
  );
}

/** Filesystem-safe, and still recognisable in a downloads folder. */
function safeName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9-_ ]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60);
}

async function shareFile(uri: string, mimeType: string, dialogTitle: string) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, { mimeType, dialogTitle, UTI: mimeType });
}

/** Writes into the app's own cache and returns the file. */
function stage(fileName: string, extension: string, contents: string): File {
  // Cache, not documents: a report is derived from data the server already
  // holds, so it never needs to survive being cleaned up.
  const file = new File(Paths.cache, `${safeName(fileName)}.${extension}`);
  if (file.exists) file.delete();
  file.create();
  file.write(contents);
  return file;
}

/**
 * Copies a staged file into a folder the person chooses.
 *
 * The share sheet can already reach Drive and Files, but "share" and "save"
 * are different intentions and the sheet buries the second one behind the
 * first. This opens the system folder picker instead, so the file lands
 * somewhere they can find it again without going through an app.
 *
 * Returns false when the picker was dismissed, so the caller can stay quiet
 * rather than reporting a cancellation as a failure.
 */
async function saveToFolder(source: File, fileName: string, mimeType: string): Promise<boolean> {
  let target: Directory;
  try {
    target = await Directory.pickDirectoryAsync();
  } catch {
    // Dismissing the picker throws rather than resolving. Not an error.
    return false;
  }

  const destination = target.createFile(fileName, mimeType);
  destination.write(source.textSync());
  return true;
}

export async function shareCsv(fileName: string, csv: string) {
  const file = stage(fileName, 'csv', csv);
  await shareFile(file.uri, 'text/csv', 'Share report');
}

export async function saveCsv(fileName: string, csv: string): Promise<boolean> {
  const file = stage(fileName, 'csv', csv);
  return saveToFolder(file, `${safeName(fileName)}.csv`, 'text/csv');
}

/**
 * Renders HTML to a PDF and shares it.
 *
 * Print, not a PDF library: `expo-print` uses the platform's own renderer, so
 * the output matches what the phone would print and there is no font or layout
 * engine to ship.
 */
export async function sharePdf(fileName: string, html: string) {
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  await shareFile(uri, 'application/pdf', 'Share report');
}

export async function savePdf(fileName: string, html: string): Promise<boolean> {
  const { uri } = await Print.printToFileAsync({ html, base64: false });

  let target: Directory;
  try {
    target = await Directory.pickDirectoryAsync();
  } catch {
    return false;
  }

  // Bytes, not text: a PDF is binary and `textSync()` would corrupt it.
  const source = new File(uri);
  const destination = target.createFile(`${safeName(fileName)}.pdf`, 'application/pdf');
  destination.write(source.bytesSync());
  return true;
}

/** WhatsApp, SMS, anywhere — no file, just the numbers. */
export async function shareText(message: string) {
  await Share.share({ message });
}

/**
 * A print stylesheet that assumes nothing about the viewer.
 *
 * Deliberately plain: system fonts, no colour that matters, no external asset.
 * A PDF that has to fetch a webfont renders differently or not at all depending
 * on when it is opened, and this is a financial record.
 */
export function reportHtml(title: string, subtitle: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<style>
  @page { margin: 24px; }
  body { font-family: -apple-system, Roboto, "Helvetica Neue", sans-serif; color: #12211C; font-size: 12px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  .sub { color: #66756F; font-size: 12px; margin: 0 0 18px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
  th, td { text-align: left; padding: 7px 6px; border-bottom: 1px solid #E3E9E6; }
  th { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #66756F; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  tr.total td { font-weight: 700; border-top: 2px solid #12211C; border-bottom: none; }
  .foot { color: #9AA8A3; font-size: 10px; margin-top: 24px; }
</style></head><body>
<h1>${title}</h1>
<p class="sub">${subtitle}</p>
${body}
<p class="foot">Generated by Kobox on ${new Date().toLocaleString('en-GB')}. Amounts are as recorded in the app.</p>
</body></html>`;
}
