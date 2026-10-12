import { errorMessage } from '@freefounders/core';
import { resolveCode } from '@freefounders/core/assets';
import { Plus, ScanLine, Search } from 'lucide-react';
import { type ReactNode, Suspense, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  DialogDescription,
} from '@/components/ui/overlays';
import { useHotkeys, useScannerInput } from '@/lib/hotkeys';
import { SearchPalette } from './components/search-palette';
import { useAuth } from './lib/auth';
import { ASSETS_GOTO } from './nav';
import { QuickAddProvider, useQuickAdd, useQuickAddItems } from './quick-add/quick-add';

const SHORTCUTS: [string, string][] = [
  ['Ctrl / ⌘ + K', 'Search & command palette'],
  ['/', 'Search'],
  ['N', 'Quick add menu'],
  ['G then D / A / E / X', 'Dashboard / Assets / Employees / Exits'],
  ['G then Q / R / T / M / S', 'Priority queue / Requests / Tickets / Maintenance / Scan'],
  ['J / K', 'Move down / up in a table'],
  ['Enter', 'Open the highlighted row'],
  ['X', 'Select the highlighted row'],
  ['[ / ]', 'Previous / next page'],
  ['Ctrl / ⌘ + Enter', 'Save the open form'],
  ['Esc', 'Close dialogs and panels'],
];

/**
 * Around every Assets screen (the old Assets app shell, minus what the FreeFounders shell already has): the "+ Add"
 * forms, the search palette, the Assets keyboard shortcuts and USB scanner input, and a slim toolbar
 * (search · scan · + Add) at the top of the page.
 */
export function AssetsFrame({ children }: { children?: ReactNode }) {
  return (
    <QuickAddProvider>
      <FrameInner>{children ?? <Outlet />}</FrameInner>
    </QuickAddProvider>
  );
}

function FrameInner({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const quickAdd = useQuickAdd();
  const adds = useQuickAddItems();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const canScan = can('asset:view', 'employee:view');

  useHotkeys(
    {
      'mod+k': () => setPaletteOpen((o) => !o),
      '/': () => setPaletteOpen(true),
      n: () => {
        if (!adds.length) return false;
        setAddOpen(true);
      },
      question: () => setHelp(true),
      '?': () => setHelp(true),
      ...Object.fromEntries(Object.entries(ASSETS_GOTO).map(([k, to]) => [`g ${k}`, () => void navigate(to)])),
    },
    [adds.length],
  );

  // USB barcode / QR scanners type fast and press Enter: jump straight to the asset or person.
  useScannerInput(async (code) => {
    if (location.pathname.startsWith('/assets/exits/')) return; // the exit checklist handles scans itself
    if (!canScan) return;
    try {
      const r = await resolveCode(code);
      navigate(r.to);
      toast.success(`Scanned ${r.label}`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });

  return (
    <>
      <div className="mb-4 flex items-center gap-2 no-print">
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Search assets, people, tags"
          className="flex h-9 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 text-sm text-muted-foreground shadow-xs transition hover:border-primary/40 max-sm:h-11 sm:max-w-md"
        >
          <Search className="size-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate text-left">Search assets, people, tags…</span>
          <span className="hidden items-center gap-0.5 sm:flex">
            <Kbd>Ctrl</Kbd>
            <Kbd>K</Kbd>
          </span>
        </button>
        <div className="ml-auto flex shrink-0 items-center gap-1 max-sm:gap-2">
          {canScan && (
            <Button variant="ghost" size="icon-sm" className="max-sm:size-11" onClick={() => navigate('/assets/scan')} aria-label="Scan QR or barcode" title="Scan">
              <ScanLine />
            </Button>
          )}
          {adds.length > 0 && (
            <DropdownMenu open={addOpen} onOpenChange={setAddOpen}>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-1.5 max-sm:h-11 max-sm:min-w-11" aria-label="Add">
                  <Plus className="size-4" />
                  <span className="hidden sm:inline">Add</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="w-56"
                onKeyDown={(e) => {
                  const n = Number(e.key);
                  if (n >= 1 && n <= adds.length) {
                    e.preventDefault();
                    setAddOpen(false);
                    quickAdd.open(adds[n - 1].kind);
                  }
                }}
              >
                <DropdownMenuLabel>Quick add</DropdownMenuLabel>
                {adds.map((a, i) => (
                  <DropdownMenuItem key={a.kind} onSelect={() => quickAdd.open(a.kind)}>
                    <Plus />
                    {a.label}
                    {i < 9 && <DropdownMenuShortcut>{i + 1}</DropdownMenuShortcut>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      <Suspense fallback={<PageLoader />}>{children}</Suspense>
      <SearchPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <Dialog open={help} onOpenChange={setHelp}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Keyboard shortcuts</DialogTitle>
            <DialogDescription>Work faster without the mouse.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y text-sm">
            {SHORTCUTS.map(([k, v]) => (
              <li key={k} className="flex items-center justify-between gap-4 py-2">
                <span className="text-muted-foreground">{v}</span>
                <span className="font-mono text-xs font-medium">{k}</span>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
