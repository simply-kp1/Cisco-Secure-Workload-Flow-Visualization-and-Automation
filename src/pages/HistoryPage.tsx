import { History, Redo2, RotateCcw, Undo2 } from 'lucide-react';
import type { ChangeType } from '@/types';
import { formatPorts } from '@/services/ports';
import { useAppStore } from '@/store/useAppStore';
import { useGraph } from '@/store/selectors';
import { Badge, Button, Card, CardHeader, EmptyState, useToast } from '@/components/ui';
import { ACTION_STYLES, cx } from '@/lib/design';

const TYPE_STYLES: Record<ChangeType, { label: string; chip: string }> = {
  ADD_RULE: { label: 'Added', chip: 'bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-200' },
  MODIFY_RULE: { label: 'Modified', chip: 'bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200' },
  DELETE_RULE: { label: 'Deleted', chip: 'bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-200' },
  DISABLE_RULE: { label: 'Disabled', chip: 'bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200' },
  ENABLE_RULE: { label: 'Enabled', chip: 'bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-200' },
};

/**
 * Session change history. Held entirely in memory — no backend — and paired
 * with the undo/redo stack so any applied change can be walked back.
 */
export function HistoryPage() {
  const history = useAppStore((state) => state.history);
  const undoCount = useAppStore((state) => state.undoStack.length);
  const redoCount = useAppStore((state) => state.redoStack.length);
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const revertAll = useAppStore((state) => state.revertAll);
  const proposedChange = useAppStore((state) => state.proposedChange);
  const discard = useAppStore((state) => state.discardProposedChange);
  const graph = useGraph();
  const toast = useToast();

  if (!graph) return null;

  const name = (id: string): string => graph.serversById.get(id)?.name ?? id;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader
          title="Session change history"
          subtitle="Every change applied since the file was imported. Nothing is persisted — reloading the page restores the imported policy."
          icon={History}
          action={
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" icon={Undo2} disabled={undoCount === 0} onClick={undo}>
                Undo
              </Button>
              <Button size="sm" variant="secondary" icon={Redo2} disabled={redoCount === 0} onClick={redo}>
                Redo
              </Button>
              <Button
                size="sm"
                variant="ghost"
                icon={RotateCcw}
                disabled={history.length === 0}
                onClick={() => {
                  revertAll();
                  toast('All changes reverted. The policy is back to the imported state.', 'info');
                }}
              >
                Revert all
              </Button>
            </div>
          }
        />
      </Card>

      {proposedChange ? (
        <Card className="border-amber-200 bg-amber-50/40">
          <div className="flex items-center gap-3 px-5 py-3.5">
            <Badge className="bg-amber-100 text-amber-800">Proposed</Badge>
            <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-800">
              {proposedChange.label}
            </span>
            {proposedChange.analysis ? (
              <span className="text-[12px] text-ink-500">
                {proposedChange.analysis.risk.rating} risk · not applied
              </span>
            ) : null}
            <Button size="sm" variant="ghost" onClick={discard}>
              Discard proposed change
            </Button>
          </div>
        </Card>
      ) : null}

      {history.length === 0 ? (
        <Card>
          <EmptyState
            icon={History}
            title="No changes applied yet"
            description="Rules you add, edit, disable or delete appear here with their before and after states and a summary of what the change did to connectivity."
          />
        </Card>
      ) : (
        <div className="space-y-2">
          {history.map((entry, index) => {
            const style = TYPE_STYLES[entry.type];
            return (
              <Card key={entry.id} className="overflow-hidden">
                <div className="flex flex-wrap items-center gap-3 px-5 py-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-[11px] font-bold tabular-nums text-ink-500">
                    {history.length - index}
                  </span>
                  <Badge className={style.chip}>{style.label}</Badge>
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-800">
                    {entry.label}
                  </span>
                  <span className="mono shrink-0 text-[11.5px] text-ink-400">
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>
                </div>

                <div className="border-t border-ink-100 bg-ink-50/50 px-5 py-3">
                  <p className="mb-2.5 text-[12.5px] text-ink-600">{entry.impactSummary}</p>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <RuleSnapshot label="Before" rule={entry.before} name={name} />
                    <RuleSnapshot label="After" rule={entry.after} name={name} />
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RuleSnapshot({
  label,
  rule,
  name,
}: {
  label: string;
  rule: { source: string; destination: string; protocol: string; ports: { from: number; to: number }[]; action: 'ALLOW' | 'DENY'; name: string } | null;
  name: (id: string) => string;
}) {
  return (
    <div className="rounded-lg border border-ink-200 bg-white px-3 py-2">
      <p className="mb-1 text-[10.5px] font-bold uppercase tracking-wider text-ink-400">{label}</p>
      {rule ? (
        <>
          <p className="truncate text-[12.5px] font-semibold text-ink-800">{rule.name}</p>
          <p className="mono mt-0.5 truncate text-[11.5px] text-ink-500">
            {name(rule.source)} → {name(rule.destination)} · {rule.protocol} {formatPorts(rule.ports)}
          </p>
          <span className={cx('chip mt-1.5 text-[10px]', ACTION_STYLES[rule.action].chip)}>{rule.action}</span>
        </>
      ) : (
        <p className="text-[12.5px] italic text-ink-400">
          {label === 'Before' ? 'The rule did not exist' : 'The rule no longer exists'}
        </p>
      )}
    </div>
  );
}
