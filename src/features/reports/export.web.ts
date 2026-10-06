import { safeName } from './report-format';

export { reportHtml, toCsv } from './report-format';

/**
 * Getting a report out of the app, in a browser.
 *
 * Metro picks this file over `export.ts` for the web build. The phone version
 * leans on three native modules — the print renderer, the share sheet and the
 * file system — none of which exist here, so each route is rebuilt on what a
 * browser does have: a download, the print dialog, and the clipboard.
 *
 * Sharing a file and saving a file are the same act in a browser: both end in
 * the downloads folder. The screen offers one "Download" row on the web for
 * that reason, and the share variants below simply do the same thing.
 */

function download(fileName: string, contents: string, mimeType: string) {
  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Not immediately: Safari cancels a download whose URL is revoked in the
  // same tick as the click.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export async function saveCsv(fileName: string, csv: string): Promise<boolean> {
  download(`${safeName(fileName)}.csv`, csv, 'text/csv;charset=utf-8');
  return true;
}

export async function shareCsv(fileName: string, csv: string) {
  await saveCsv(fileName, csv);
}

/**
 * Opens the report in the browser's print dialog, where "Save as PDF" is one of
 * the destinations on every current browser.
 *
 * There is no PDF renderer to call here and shipping one would add a font and
 * layout engine to every page load for a report most people open once a month.
 *
 * Returns false — the dialog reports nothing back, so there is no honest way
 * to say a file was saved.
 */
export async function savePdf(fileName: string, html: string): Promise<boolean> {
  // The title is what the browser offers as the PDF's file name.
  const titled = html.replace('<head>', `<head><title>${safeName(fileName)}</title>`);

  // A tab of its own, opened before anything is awaited so it still counts as
  // the click that asked for it. iOS Safari prints the whole PAGE when asked
  // to print a hidden frame, which is why this is not an iframe.
  const tab = window.open('', '_blank');
  if (!tab) {
    throw new Error('Your browser blocked the report window. Allow pop-ups for Kobox.');
  }

  tab.document.open();
  tab.document.write(titled);
  tab.document.close();
  tab.focus();
  // Let the new document lay out first, or some browsers print a blank page.
  setTimeout(() => tab.print(), 250);
  return false;
}

export async function sharePdf(fileName: string, html: string) {
  await savePdf(fileName, html);
}

/**
 * The share sheet where the browser has one (every phone browser), the
 * clipboard where it does not (most desktops).
 */
export async function shareText(message: string): Promise<'shared' | 'copied'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text: message });
      return 'shared';
    } catch (err) {
      // Closing the sheet rejects with AbortError. Not a failure.
      if (err instanceof Error && err.name === 'AbortError') return 'shared';
      // Anything else: fall through to the clipboard.
    }
  }

  await navigator.clipboard.writeText(message);
  return 'copied';
}
