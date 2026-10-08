import { Paperclip, X } from 'lucide-react';
import { useRef } from 'react';
import { Button } from '@/components/ui/button';

/**
 * The file button: a hidden file input driven by a normal button, so picking a photo looks like the rest of the app.
 * The chosen files stay with the caller (some screens upload at once, others on submit).
 */
export function FilePick({
  onPick,
  multiple = true,
  disabled = false,
  accept,
  label = 'Add photo or file',
  busyLabel = 'Uploading…',
  busy = false,
}: {
  onPick: (files: File[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  accept?: string;
  label?: string;
  busyLabel?: string;
  busy?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple={multiple}
        accept={accept}
        disabled={disabled || busy}
        hidden
        aria-label={label}
        onChange={(e) => {
          const picked = [...(e.target.files ?? [])];
          e.target.value = ''; // the same file twice in a row still fires
          if (picked.length) onPick(picked);
        }}
      />
      <Button type="button" variant="outline" size="sm" disabled={disabled} loading={busy} onClick={() => ref.current?.click()}>
        {!busy && <Paperclip />}
        {busy ? busyLabel : label}
      </Button>
    </>
  );
}

/** Adds picked files to a list: no duplicates (same name and size), at most `max`. */
export function addFiles(prev: File[], picked: File[], max = 5): File[] {
  return [...prev, ...picked].filter((f, i, all) => all.findIndex((x) => x.name === f.name && x.size === f.size) === i).slice(0, max);
}

/** Files chosen but not sent yet, each with a remove button. */
export function PickedFiles({ files, onRemove }: { files: File[]; onRemove: (index: number) => void }) {
  if (!files.length) return null;
  return (
    <ul className="mt-2 space-y-1">
      {files.map((f, i) => (
        <li key={`${f.name}-${i}`} className="flex items-center gap-2 rounded-md border bg-muted/30 px-2.5 py-1.5 text-sm">
          <Paperclip className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{f.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{Math.round(f.size / 1024)} KB</span>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)}>
            <X />
          </Button>
        </li>
      ))}
    </ul>
  );
}
