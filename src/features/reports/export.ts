import { Directory, File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Share } from 'react-native';

import { safeName } from './report-format';

export { reportHtml, toCsv } from './report-format';

/**
 * Getting a report out of the app.
 *
 * Three routes, because groups use three different ones: a WhatsApp message to
 * the group chat, a CSV for whoever keeps the spreadsheet, and a PDF for the
 * file an auditor signs. The share sheet handles delivery in every case, so
 * none of this needs a per-app integration.
 */

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
export async function shareText(message: string): Promise<'shared' | 'copied'> {
  await Share.share({ message });
  return 'shared';
}
