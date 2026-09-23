import { PanelLeftClose, PanelLeftOpen, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { Badge, Button, IconButton, Tooltip } from '@/components/ui';
import { GlobalSearch } from './GlobalSearch';
import type { PageId } from './Sidebar';

export function TopBar({
  title,
  subtitle,
  onNavigate,
  onToggleSidebar,
  sidebarCollapsed,
  actions,
}: {
  title: string;
  subtitle?: string;
  onNavigate: (page: PageId) => void;
  onToggleSidebar: () => void;
  sidebarCollapsed: boolean;
  actions?: React.ReactNode;
}) {
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const revertAll = useAppStore((state) => state.revertAll);
  const undoCount = useAppStore((state) => state.undoStack.length);
  const redoCount = useAppStore((state) => state.redoStack.length);
  const historyCount = useAppStore((state) => state.history.length);
  const dataset = useAppStore((state) => state.workingDataset);

  return (
    <header className="flex shrink-0 flex-col gap-2 border-b border-ink-200 bg-white/95 px-5 py-3 backdrop-blur md:flex-row md:items-center">
      <div className="flex min-w-0 items-center gap-2.5">
        <IconButton
          icon={sidebarCollapsed ? PanelLeftOpen : PanelLeftClose}
          label={sidebarCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          onClick={onToggleSidebar}
        />
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-bold leading-tight tracking-tight text-ink-800">{title}</h1>
          {subtitle ? <p className="truncate text-[12.5px] text-ink-500">{subtitle}</p> : null}
        </div>
      </div>

      <div className="flex flex-1 items-center justify-end gap-2">
        <GlobalSearch onNavigate={onNavigate} />

        {dataset ? (
          <div className="flex items-center gap-1 border-l border-ink-200 pl-2">
            <Tooltip content={undoCount > 0 ? 'Undo the last applied change' : 'Nothing to undo'}>
              <IconButton icon={Undo2} label="Undo" disabled={undoCount === 0} onClick={undo} />
            </Tooltip>
            <Tooltip content={redoCount > 0 ? 'Redo' : 'Nothing to redo'}>
              <IconButton icon={Redo2} label="Redo" disabled={redoCount === 0} onClick={redo} />
            </Tooltip>
            {historyCount > 0 ? (
              <Tooltip content="Discard every change and return to the imported policy">
                <Button size="sm" variant="ghost" icon={RotateCcw} onClick={revertAll}>
                  Revert all
                  <Badge className="ml-1 bg-amber-100 text-amber-700">{historyCount}</Badge>
                </Button>
              </Tooltip>
            ) : null}
          </div>
        ) : null}

        {actions ? <div className="flex items-center gap-2 border-l border-ink-200 pl-2">{actions}</div> : null}
      </div>
    </header>
  );
}
