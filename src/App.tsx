import { useState } from 'react';
import { ShieldCheck, Sparkles } from 'lucide-react';
import { useAppStore } from '@/store/useAppStore';
import { useDataset, useIssues } from '@/store/selectors';
import { Button, Card, ToastProvider, useToast } from '@/components/ui';
import { NAV_ITEMS, Sidebar, type PageId } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { UploadDropzone } from '@/components/upload/UploadDropzone';
import { DashboardPage } from '@/pages/DashboardPage';
import { NetworkMapPage } from '@/pages/NetworkMapPage';
import { ServersPage } from '@/pages/ServersPage';
import { RulesPage } from '@/pages/RulesPage';
import { PortsPage } from '@/pages/PortsPage';
import { PathExplorerPage } from '@/pages/PathExplorerPage';
import { ChangeAnalysisPage } from '@/pages/ChangeAnalysisPage';
import { ConflictsPage } from '@/pages/ConflictsPage';
import { HistoryPage } from '@/pages/HistoryPage';
import { ImportExportPage } from '@/pages/ImportExportPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { cx } from '@/lib/design';

const PAGE_SUBTITLES: Record<PageId, string> = {
  dashboard: 'Policy overview and key statistics',
  network: 'Interactive topology of every server and connection',
  servers: 'Every server, its connections and its dependencies',
  rules: 'Search, sort, edit and analyse individual rules',
  ports: 'Which ports the policy uses, and who uses them',
  paths: 'Find every permitted route between two servers',
  change: 'Simulate a rule change before applying it',
  conflicts: 'Duplicates, conflicts and other policy findings',
  history: 'Changes applied during this session',
  import: 'Load a policy file and export the working state',
  settings: 'Analysis depth and rendering preferences',
};

/** Pages that manage their own scrolling and need the full viewport height. */
const FULL_HEIGHT_PAGES = new Set<PageId>(['network', 'change', 'paths']);

function Shell() {
  const [page, setPage] = useState<PageId>('dashboard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const dataset = useDataset();
  const issues = useIssues();
  const proposedChange = useAppStore((state) => state.proposedChange);

  const navItem = NAV_ITEMS.find((item) => item.id === page);
  const fullHeight = FULL_HEIGHT_PAGES.has(page);

  return (
    <div className="flex h-full overflow-hidden bg-ink-50">
      <Sidebar
        page={page}
        onNavigate={setPage}
        issueCount={issues.length}
        hasProposedChange={Boolean(proposedChange)}
        collapsed={sidebarCollapsed}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          title={navItem?.label ?? 'Dashboard'}
          subtitle={PAGE_SUBTITLES[page]}
          onNavigate={setPage}
          onToggleSidebar={() => setSidebarCollapsed((value) => !value)}
          sidebarCollapsed={sidebarCollapsed}
        />

        <main
          className={cx(
            'min-h-0 flex-1',
            fullHeight ? 'overflow-hidden p-4' : 'overflow-y-auto p-4 md:p-5',
          )}
        >
          {!dataset ? <WelcomeScreen onNavigate={setPage} /> : <Page page={page} onNavigate={setPage} />}
        </main>
      </div>
    </div>
  );
}

function Page({ page, onNavigate }: { page: PageId; onNavigate: (page: PageId) => void }) {
  switch (page) {
    case 'dashboard':
      return <DashboardPage onNavigate={onNavigate} />;
    case 'network':
      return <NetworkMapPage onNavigate={onNavigate} />;
    case 'servers':
      return <ServersPage onNavigate={onNavigate} />;
    case 'rules':
      return <RulesPage onNavigate={onNavigate} />;
    case 'ports':
      return <PortsPage onNavigate={onNavigate} />;
    case 'paths':
      return <PathExplorerPage />;
    case 'change':
      return <ChangeAnalysisPage onNavigate={onNavigate} />;
    case 'conflicts':
      return <ConflictsPage onNavigate={onNavigate} />;
    case 'history':
      return <HistoryPage />;
    case 'import':
      return <ImportExportPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <DashboardPage onNavigate={onNavigate} />;
  }
}

/* ------------------------------------------------------------------ *
 * Welcome
 * ------------------------------------------------------------------ */

function WelcomeScreen({ onNavigate }: { onNavigate: (page: PageId) => void }) {
  const loadSample = useAppStore((state) => state.loadSample);
  const toast = useToast();

  const features = [
    {
      title: 'See the whole policy at once',
      body: 'Every server becomes a node and every rule a directed connection, laid out by force simulation, tier, environment or zone.',
    },
    {
      title: 'Know what a change will do first',
      body: 'Propose a rule change and see exactly what connectivity appears or disappears, which systems sit in the blast radius, and whether equivalent access already exists — before anything is applied.',
    },
    {
      title: 'Find the problems already there',
      body: 'Duplicate rules, ALLOW/DENY conflicts, port overlaps, redundant rules, overly broad permissions and isolated servers are detected automatically.',
    },
    {
      title: 'Explained in plain English',
      body: 'Findings are written so both network engineers and business stakeholders can read them — and the analysis never claims an application will break when the data cannot prove it.',
    },
  ];

  return (
    <div className="mx-auto max-w-4xl py-6">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 shadow-lift">
          <ShieldCheck className="h-7 w-7 text-white" strokeWidth={2.2} />
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-ink-800">Secure Workload Policy Visualiser</h1>
        <p className="mx-auto mt-2 max-w-xl text-[15px] leading-relaxed text-ink-500">
          Turn a network policy export into an interactive topology, then simulate any rule change and see exactly
          what it affects before you make it.
        </p>
      </div>

      <Card className="mb-6 p-5">
        <UploadDropzone onLoaded={(ok, message) => toast(message, ok ? 'success' : 'danger')} />
      </Card>

      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {features.map((feature) => (
          <Card key={feature.title} className="p-4">
            <h3 className="text-[14px] font-semibold tracking-tight text-ink-800">{feature.title}</h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-ink-500">{feature.body}</p>
          </Card>
        ))}
      </div>

      <div className="flex flex-col items-center gap-3 rounded-2xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white px-6 py-6 text-center">
        <Sparkles className="h-5 w-5 text-brand-500" strokeWidth={2.2} />
        <div>
          <h3 className="text-[15px] font-semibold text-ink-800">No file to hand?</h3>
          <p className="mt-1 text-[13px] text-ink-500">
            Load the demo environment: 50 servers, 149 rules, and a handful of deliberate policy problems to find.
          </p>
        </div>
        <Button
          variant="primary"
          icon={Sparkles}
          onClick={() => {
            const validation = loadSample();
            toast(
              `Loaded ${validation.serversDetected} servers and ${validation.rulesDetected} rules.`,
              'success',
            );
            onNavigate('dashboard');
          }}
        >
          Load Demo Environment
        </Button>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
