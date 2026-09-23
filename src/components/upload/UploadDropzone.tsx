import { useCallback, useRef, useState } from 'react';
import { FileJson, FolderOpen, Loader2, Sparkles, UploadCloud } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Button } from '@/components/ui';
import { cx } from '@/lib/design';

export function UploadDropzone({
  onLoaded,
  compact,
}: {
  onLoaded?: (ok: boolean, message: string) => void;
  compact?: boolean;
}) {
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadDocument = useAppStore((state) => state.loadDocument);
  const loadSample = useAppStore((state) => state.loadSample);

  const handleFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setError(null);
      try {
        const text = await file.text();
        const validation = loadDocument(text, file.name);
        if (validation.serversDetected === 0 && validation.rulesDetected === 0) {
          const first = validation.issues[0]?.message ?? 'The file could not be read.';
          setError(first);
          onLoaded?.(false, first);
        } else {
          onLoaded?.(
            true,
            `Imported ${validation.serversDetected} servers and ${validation.rulesDetected} rules from ${file.name}.`,
          );
        }
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : 'The file could not be read.';
        setError(message);
        onLoaded?.(false, message);
      } finally {
        setBusy(false);
      }
    },
    [loadDocument, onLoaded],
  );

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (!file) return;
      if (!file.name.toLowerCase().endsWith('.json') && file.type !== 'application/json') {
        setError(`"${file.name}" is not a JSON file. Export the policy as JSON and try again.`);
        return;
      }
      void handleFile(file);
    },
    [handleFile],
  );

  return (
    <div>
      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          'relative rounded-2xl border-2 border-dashed transition-all duration-200',
          compact ? 'px-5 py-7' : 'px-6 py-12',
          dragging
            ? 'border-brand-400 bg-brand-50 shadow-lift'
            : 'border-ink-300 bg-white hover:border-brand-300 hover:bg-brand-50/30',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
            event.target.value = '';
          }}
        />

        <div className="flex flex-col items-center text-center">
          <div
            className={cx(
              'mb-3 flex items-center justify-center rounded-2xl transition-all duration-200',
              compact ? 'h-11 w-11' : 'h-14 w-14',
              dragging ? 'scale-110 bg-brand-100 text-brand-600' : 'bg-ink-100 text-ink-400',
            )}
          >
            {busy ? (
              <Loader2 className={cx('animate-spin', compact ? 'h-5 w-5' : 'h-6 w-6')} />
            ) : (
              <UploadCloud className={compact ? 'h-5 w-5' : 'h-6 w-6'} strokeWidth={2} />
            )}
          </div>

          <h3 className={cx('font-semibold tracking-tight text-ink-800', compact ? 'text-sm' : 'text-base')}>
            {dragging ? 'Drop the file to import it' : 'Drag and drop a policy JSON file'}
          </h3>
          <p className={cx('mt-1 max-w-sm text-ink-500', compact ? 'text-[12.5px]' : 'text-[13px]')}>
            Servers and rules with consumer/provider (or source/destination) references. Nothing is uploaded —
            the file is read entirely in your browser.
          </p>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button variant="primary" icon={FolderOpen} onClick={() => inputRef.current?.click()} disabled={busy}>
              Browse computer
            </Button>
            <Button
              variant="secondary"
              icon={Sparkles}
              disabled={busy}
              onClick={() => {
                const validation = loadSample();
                onLoaded?.(
                  true,
                  `Loaded the demo environment: ${validation.serversDetected} servers and ${validation.rulesDetected} rules.`,
                );
              }}
            >
              Load Demo Environment
            </Button>
          </div>
        </div>
      </div>

      {error ? (
        <div className="mt-3 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3.5 py-2.5">
          <FileJson className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          <p className="text-[13px] leading-relaxed text-rose-800">{error}</p>
        </div>
      ) : null}
    </div>
  );
}
