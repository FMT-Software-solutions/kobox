import { Download, FileText, MessageCircle, Table } from 'lucide-react-native';
import { useState } from 'react';
import { Platform, View } from 'react-native';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { useBrand } from '@/features/groups/brand';

import { saveCsv, savePdf, shareCsv, sharePdf, shareText } from './export';

const IS_WEB = Platform.OS === 'web';

export interface ExportActionsProps {
  /** Built lazily: a report only pays for the format actually chosen. */
  fileName: () => string;
  text: () => string;
  csv: () => string;
  html: () => string;
  disabled?: boolean;
}

/**
 * The five ways a report leaves the app, in one place.
 *
 * Every report screen had grown its own copy of these buttons and its own
 * `run()`, which is how the save actions ended up on one screen and not the
 * others. Sharing and saving are different intentions — the share sheet can
 * reach Drive, but it buries "put this file somewhere I can find it" behind an
 * app chooser — so both are offered rather than one standing in for the other.
 */
export function ExportActions({ fileName, text, csv, html, disabled }: ExportActionsProps) {
  const brand = useBrand();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(kind: 'text' | 'share-csv' | 'share-pdf' | 'save-csv' | 'save-pdf') {
    setError(null);
    setNotice(null);
    setBusy(kind);

    try {
      if (kind === 'text') {
        // A desktop browser has no share sheet, so the text goes to the
        // clipboard instead and has to say so.
        if ((await shareText(text())) === 'copied') setNotice('Copied.');
      } else if (kind === 'share-csv') {
        await shareCsv(fileName(), csv());
      } else if (kind === 'share-pdf') {
        await sharePdf(fileName(), html());
      } else {
        // Saving can be cancelled at the folder picker, which is not a failure.
        // Say nothing rather than claim a file was written.
        const saved =
          kind === 'save-csv'
            ? await saveCsv(fileName(), csv())
            : await savePdf(fileName(), html());
        if (saved) setNotice('Saved.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not export that report.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <View className="gap-2">
      <Button
        label="Share as a message"
        variant="outline"
        fullWidth
        disabled={disabled}
        icon={<MessageCircle size={16} color={brand.deep} />}
        loading={busy === 'text'}
        onPress={() => run('text')}
      />

      {/* In a browser, sharing a file and saving one are the same download,
          so the web build offers the one row. */}
      {!IS_WEB && (
        <>
          <Text variant="caption" className="mt-1">
            Share a file
          </Text>
          <View className="flex-row gap-2">
            <Button
              label="CSV"
              variant="outline"
              className="flex-1"
              disabled={disabled}
              icon={<Table size={16} color={brand.deep} />}
              loading={busy === 'share-csv'}
              onPress={() => run('share-csv')}
            />
            <Button
              label="PDF"
              variant="outline"
              className="flex-1"
              disabled={disabled}
              icon={<FileText size={16} color={brand.deep} />}
              loading={busy === 'share-pdf'}
              onPress={() => run('share-pdf')}
            />
          </View>
        </>
      )}

      <Text variant="caption" className="mt-1">
        {IS_WEB ? 'Download' : 'Save to this phone'}
      </Text>
      <View className="flex-row gap-2">
        <Button
          label="CSV"
          variant="outline"
          className="flex-1"
          disabled={disabled}
          icon={<Download size={16} color={brand.deep} />}
          loading={busy === 'save-csv'}
          onPress={() => run('save-csv')}
        />
        <Button
          label="PDF"
          variant="outline"
          className="flex-1"
          disabled={disabled}
          icon={<Download size={16} color={brand.deep} />}
          loading={busy === 'save-pdf'}
          onPress={() => run('save-pdf')}
        />
      </View>

      {notice && (
        <View className="rounded-lg bg-success/10 p-3">
          <Text variant="caption" className="text-success">
            {notice}
          </Text>
        </View>
      )}

      {error && (
        <View className="rounded-lg bg-destructive/10 p-3">
          <Text variant="caption" className="text-destructive">
            {error}
          </Text>
        </View>
      )}
    </View>
  );
}
