import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
  Search,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cx } from '@/lib/design';

/* ------------------------------------------------------------------ *
 * Button
 * ------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
  secondary:
    'bg-white text-ink-700 ring-1 ring-inset ring-ink-200 hover:bg-ink-50 hover:ring-ink-300 active:bg-ink-100',
  ghost: 'text-ink-600 hover:bg-ink-100 hover:text-ink-800 active:bg-ink-200',
  danger: 'bg-rose-600 text-white shadow-sm hover:bg-rose-700 active:bg-rose-800 disabled:bg-rose-300',
  subtle: 'bg-brand-50 text-brand-700 hover:bg-brand-100 active:bg-brand-200',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5 rounded-lg',
  md: 'h-9 px-3.5 text-sm gap-2 rounded-lg',
  lg: 'h-11 px-5 text-[15px] gap-2 rounded-xl',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: LucideIcon;
  iconRight?: LucideIcon;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon: Icon,
  iconRight: IconRight,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex select-none items-center justify-center font-semibold transition-all duration-150',
        'disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.985]',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    >
      {Icon ? <Icon className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={2.2} /> : null}
      {children}
      {IconRight ? <IconRight className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'} strokeWidth={2.2} /> : null}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Icon button
 * ------------------------------------------------------------------ */

export function IconButton({
  icon: Icon,
  label,
  active,
  className,
  ...props
}: { icon: LucideIcon; label: string; active?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cx(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg transition-all duration-150',
        'active:scale-90 disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-brand-600 text-white shadow-sm'
          : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800',
        className,
      )}
      {...props}
    >
      <Icon className="h-4 w-4" strokeWidth={2.2} />
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * Card
 * ------------------------------------------------------------------ */

export function Card({
  className,
  children,
  hoverable,
  ...props
}: { hoverable?: boolean } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx('card', hoverable && 'card-hover cursor-pointer', className)} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  subtitle,
  icon: Icon,
  action,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: LucideIcon;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex items-start justify-between gap-4 px-5 pb-3 pt-4', className)}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {Icon ? <Icon className="h-4 w-4 shrink-0 text-ink-400" strokeWidth={2.2} /> : null}
          <h3 className="truncate text-[15px] font-semibold tracking-tight text-ink-800">{title}</h3>
        </div>
        {subtitle ? <p className="mt-1 text-[13px] leading-snug text-ink-500">{subtitle}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Badge
 * ------------------------------------------------------------------ */

export function Badge({
  children,
  className,
  icon: Icon,
  dot,
}: {
  children: ReactNode;
  className?: string;
  icon?: LucideIcon;
  dot?: string;
}) {
  return (
    <span className={cx('chip', className ?? 'bg-ink-100 text-ink-600 ring-1 ring-inset ring-ink-200')}>
      {dot ? <span className={cx('h-1.5 w-1.5 rounded-full', dot)} /> : null}
      {Icon ? <Icon className="h-3 w-3" strokeWidth={2.4} /> : null}
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Inputs
 * ------------------------------------------------------------------ */

export function TextInput({
  label,
  hint,
  error,
  icon: Icon,
  className,
  ...props
}: { label?: string; hint?: string; error?: string; icon?: LucideIcon } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="relative">
        {Icon ? (
          <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        ) : null}
        <input
          id={id}
          className={cx('input', Icon && 'pl-9', error && 'border-rose-300 focus:border-rose-400 focus:ring-rose-100')}
          {...props}
        />
      </div>
      {error ? <p className="mt-1 text-xs font-medium text-rose-600">{error}</p> : null}
      {hint && !error ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

export function SearchInput({
  value,
  onChange,
  placeholder = 'Search…',
  className,
  onClear,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  onClear?: () => void;
}) {
  return (
    <div className={cx('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="input pl-9 pr-9"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            onClear?.();
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-ink-400 transition-colors hover:bg-ink-100 hover:text-ink-700"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

export function Select({
  label,
  hint,
  className,
  children,
  ...props
}: { label?: string; hint?: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  const id = useId();
  return (
    <div className={className}>
      {label ? (
        <label className="label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      <div className="relative">
        <select id={id} className="input cursor-pointer appearance-none pr-9" {...props}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      </div>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-700">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-snug text-ink-500">{description}</span> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-200',
          checked ? 'bg-brand-600' : 'bg-ink-300',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-200',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </button>
    </label>
  );
}

/** A multi-select rendered as toggleable pills — faster to scan than a listbox. */
export function PillGroup<T extends string>({
  options,
  selected,
  onChange,
  label,
  renderOption,
}: {
  options: { value: T; label: string; className?: string }[];
  selected: T[];
  onChange: (values: T[]) => void;
  label?: string;
  renderOption?: (option: { value: T; label: string }) => ReactNode;
}) {
  const toggle = (value: T): void => {
    onChange(selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value]);
  };

  return (
    <div>
      {label ? <span className="label">{label}</span> : null}
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const active = selected.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              aria-pressed={active}
              className={cx(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-all duration-150 active:scale-95',
                active
                  ? 'bg-brand-600 text-white shadow-sm'
                  : cx('bg-white text-ink-600 ring-1 ring-inset ring-ink-200 hover:bg-ink-50', option.className),
              )}
            >
              {active ? <Check className="h-3 w-3" strokeWidth={3} /> : null}
              {renderOption ? renderOption(option) : option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tabs
 * ------------------------------------------------------------------ */

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: { value: T; label: string; count?: number; icon?: LucideIcon }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={cx('inline-flex items-center gap-1 rounded-xl bg-ink-100 p-1', className)}>
      {tabs.map((tab) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={cx(
              'inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-all duration-150',
              active ? 'bg-white text-ink-800 shadow-sm' : 'text-ink-500 hover:text-ink-700',
            )}
          >
            {tab.icon ? <tab.icon className="h-3.5 w-3.5" strokeWidth={2.2} /> : null}
            {tab.label}
            {tab.count !== undefined ? (
              <span
                className={cx(
                  'rounded-md px-1.5 py-0.5 text-[11px] font-bold tabular-nums',
                  active ? 'bg-ink-100 text-ink-600' : 'bg-ink-200/70 text-ink-500',
                )}
              >
                {tab.count}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Empty state
 * ------------------------------------------------------------------ */

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cx('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-ink-100 text-ink-400">
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <h3 className="text-[15px] font-semibold text-ink-700">{title}</h3>
      {description ? <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-ink-500">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Callout
 * ------------------------------------------------------------------ */

const CALLOUT_TONES = {
  info: 'bg-brand-50/70 border-brand-200 text-brand-900',
  warning: 'bg-amber-50/80 border-amber-200 text-amber-900',
  danger: 'bg-rose-50/80 border-rose-200 text-rose-900',
  success: 'bg-emerald-50/80 border-emerald-200 text-emerald-900',
  neutral: 'bg-ink-50 border-ink-200 text-ink-700',
};

export function Callout({
  tone = 'info',
  title,
  children,
  icon: Icon = Info,
  className,
}: {
  tone?: keyof typeof CALLOUT_TONES;
  title?: string;
  children?: ReactNode;
  icon?: LucideIcon;
  className?: string;
}) {
  return (
    <div className={cx('rounded-xl border px-4 py-3', CALLOUT_TONES[tone], className)}>
      <div className="flex gap-2.5">
        <Icon className="mt-0.5 h-4 w-4 shrink-0 opacity-70" strokeWidth={2.2} />
        <div className="min-w-0 flex-1">
          {title ? <p className="text-[13px] font-semibold">{title}</p> : null}
          {children ? (
            <div className={cx('text-[13px] leading-relaxed opacity-90', title && 'mt-1')}>{children}</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Side panel
 * ------------------------------------------------------------------ */

export function SidePanel({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  width = 'w-[420px]',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-40 animate-fade-in bg-ink-900/10 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <aside
        className={cx(
          'fixed right-0 top-0 z-50 flex h-full flex-col animate-slide-in-right border-l border-ink-200 bg-white shadow-pop',
          width,
          'max-w-[92vw]',
        )}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-200/80 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-tight text-ink-800">{title}</div>
            {subtitle ? <div className="mt-0.5 text-[13px] text-ink-500">{subtitle}</div> : null}
          </div>
          <IconButton icon={X} label="Close panel" onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <footer className="border-t border-ink-200/80 bg-ink-50/60 px-5 py-3">{footer}</footer> : null}
      </aside>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Modal
 * ------------------------------------------------------------------ */

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = 'max-w-2xl',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4 sm:p-8">
      <div className="fixed inset-0 animate-fade-in bg-ink-900/25 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div
        className={cx(
          'relative z-10 my-auto w-full animate-slide-up rounded-2xl border border-ink-200 bg-white shadow-pop',
          size,
        )}
        role="dialog"
        aria-modal="true"
      >
        <header className="flex items-start justify-between gap-4 border-b border-ink-200/80 px-6 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold tracking-tight text-ink-800">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[13px] text-ink-500">{subtitle}</p> : null}
          </div>
          <IconButton icon={X} label="Close" onClick={onClose} />
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-ink-200/80 bg-ink-50/60 px-6 py-3.5">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Tooltip
 * ------------------------------------------------------------------ */

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className="relative inline-flex"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {children}
      {open ? (
        <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 w-max max-w-xs -translate-x-1/2 animate-fade-in rounded-lg bg-ink-800 px-2.5 py-1.5 text-xs font-medium leading-snug text-white shadow-lift">
          {content}
        </span>
      ) : null}
    </span>
  );
}

/** A small "?" that reveals an explanation — used to keep labels short. */
export function InfoHint({ children }: { children: ReactNode }) {
  return (
    <Tooltip content={children}>
      <Info className="h-3.5 w-3.5 cursor-help text-ink-300 transition-colors hover:text-ink-500" />
    </Tooltip>
  );
}

/* ------------------------------------------------------------------ *
 * Data table
 * ------------------------------------------------------------------ */

export interface Column<T> {
  key: string;
  header: string;
  width?: string;
  align?: 'left' | 'right' | 'center';
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  render: (row: T) => ReactNode;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  activeRowKey,
  sort,
  onSortChange,
  emptyState,
  dense,
  maxHeight,
  pageSize,
  itemNoun = 'rows',
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  activeRowKey?: string | null;
  sort?: { key: string; direction: 'asc' | 'desc' } | null;
  onSortChange?: (sort: { key: string; direction: 'asc' | 'desc' }) => void;
  emptyState?: ReactNode;
  dense?: boolean;
  maxHeight?: string;
  /**
   * Render at most this many rows at a time. Essential on large policies: a
   * 5,000-rule export rendered in one pass is tens of thousands of DOM nodes
   * and locks the main thread for minutes.
   */
  pageSize?: number;
  itemNoun?: string;
}) {
  const handleSort = (column: Column<T>): void => {
    if (!column.sortable || !onSortChange) return;
    const direction = sort?.key === column.key && sort.direction === 'asc' ? 'desc' : 'asc';
    onSortChange({ key: column.key, direction });
  };

  const [page, setPage] = useState(0);
  const pageCount = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  // Filtering can shrink the row set beneath the current page; clamp during
  // render so the table never shows an empty page.
  if (page > pageCount - 1) setPage(0);

  const visibleRows = pageSize ? rows.slice(page * pageSize, page * pageSize + pageSize) : rows;
  const firstIndex = pageSize ? page * pageSize + 1 : 1;
  const lastIndex = pageSize ? Math.min(rows.length, page * pageSize + pageSize) : rows.length;

  return (
    <>
    <div className={cx('overflow-auto', maxHeight)}>
      <table className="w-full border-collapse text-left">
        <thead className="sticky top-0 z-10 bg-ink-50/95 backdrop-blur">
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={{ width: column.width }}
                className={cx(
                  'whitespace-nowrap border-b border-ink-200 px-3 py-2.5 text-[11px] font-bold uppercase tracking-wider text-ink-500',
                  column.align === 'right' && 'text-right',
                  column.align === 'center' && 'text-center',
                  column.sortable && 'cursor-pointer select-none transition-colors hover:text-ink-700',
                )}
                onClick={() => handleSort(column)}
              >
                <span className="inline-flex items-center gap-1">
                  {column.header}
                  {column.sortable ? (
                    <ChevronDown
                      className={cx(
                        'h-3 w-3 transition-all duration-200',
                        sort?.key === column.key
                          ? cx('text-brand-600', sort.direction === 'asc' && 'rotate-180')
                          : 'text-ink-300',
                      )}
                    />
                  ) : null}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visibleRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-sm text-ink-400">
                {emptyState ?? 'Nothing to show.'}
              </td>
            </tr>
          ) : (
            visibleRows.map((row) => {
              const key = rowKey(row);
              return (
                <tr
                  key={key}
                  onClick={() => onRowClick?.(row)}
                  className={cx(
                    'border-b border-ink-100 transition-colors duration-100',
                    onRowClick && 'cursor-pointer hover:bg-brand-50/50',
                    activeRowKey === key && 'bg-brand-50',
                  )}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={cx(
                        'px-3 align-middle text-[13px] text-ink-700',
                        dense ? 'py-1.5' : 'py-2.5',
                        column.align === 'right' && 'text-right',
                        column.align === 'center' && 'text-center',
                      )}
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>

    {pageSize && rows.length > pageSize ? (
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-ink-100 bg-ink-50/60 px-3 py-2">
        <span className="text-[12px] font-medium tabular-nums text-ink-500">
          Showing {firstIndex.toLocaleString()}–{lastIndex.toLocaleString()} of {rows.length.toLocaleString()}{' '}
          {itemNoun}
        </span>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(0)}>
            First
          </Button>
          <IconButton
            icon={ChevronLeft}
            label="Previous page"
            disabled={page === 0}
            onClick={() => setPage((value) => Math.max(0, value - 1))}
          />
          <span className="px-1.5 text-[12px] font-semibold tabular-nums text-ink-600">
            {page + 1} / {pageCount}
          </span>
          <IconButton
            icon={ChevronRight}
            label="Next page"
            disabled={page >= pageCount - 1}
            onClick={() => setPage((value) => Math.min(pageCount - 1, value + 1))}
          />
          <Button
            size="sm"
            variant="ghost"
            disabled={page >= pageCount - 1}
            onClick={() => setPage(pageCount - 1)}
          >
            Last
          </Button>
        </div>
      </div>
    ) : null}
    </>
  );
}

/** Generic client-side sort helper matching DataTable's sort descriptor. */
export function sortRows<T>(
  rows: T[],
  columns: Column<T>[],
  sort: { key: string; direction: 'asc' | 'desc' } | null,
): T[] {
  if (!sort) return rows;
  const column = columns.find((candidate) => candidate.key === sort.key);
  if (!column?.sortValue) return rows;
  const direction = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = column.sortValue!(a);
    const right = column.sortValue!(b);
    if (typeof left === 'number' && typeof right === 'number') return (left - right) * direction;
    return String(left).localeCompare(String(right), undefined, { numeric: true }) * direction;
  });
}

/* ------------------------------------------------------------------ *
 * Stat
 * ------------------------------------------------------------------ */

export function Stat({
  label,
  value,
  hint,
  icon: Icon,
  tone = 'neutral',
  onClick,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  icon?: LucideIcon;
  tone?: 'neutral' | 'positive' | 'warning' | 'danger' | 'brand';
  onClick?: () => void;
}) {
  const tones = {
    neutral: 'text-ink-800 bg-ink-100 text-ink-500',
    positive: 'text-emerald-600 bg-emerald-50 text-emerald-600',
    warning: 'text-amber-600 bg-amber-50 text-amber-600',
    danger: 'text-rose-600 bg-rose-50 text-rose-600',
    brand: 'text-brand-600 bg-brand-50 text-brand-600',
  };
  const [valueTone, iconBg, iconColor] = tones[tone].split(' ');

  return (
    <div
      onClick={onClick}
      className={cx(
        'card flex items-start gap-3 px-4 py-3.5',
        onClick && 'card-hover cursor-pointer',
      )}
    >
      {Icon ? (
        <div className={cx('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', iconBg, iconColor)}>
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </div>
      ) : null}
      <div className="min-w-0">
        <div className={cx('text-[26px] font-bold leading-none tracking-tight tabular-nums', valueTone)}>{value}</div>
        <div className="mt-1.5 truncate text-[12.5px] font-medium text-ink-500">{label}</div>
        {hint ? <div className="mt-0.5 truncate text-[11.5px] text-ink-400">{hint}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Key/value rows
 * ------------------------------------------------------------------ */

export function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-ink-100 py-2 last:border-0">
      <span className="shrink-0 text-[12.5px] font-medium text-ink-500">{label}</span>
      <span className={cx('min-w-0 text-right text-[13px] font-medium text-ink-800', mono && 'mono')}>
        {children}
      </span>
    </div>
  );
}

export function Section({
  title,
  action,
  children,
  className,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('mb-5 last:mb-0', className)}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-400">{title}</h4>
        {action}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Toasts
 * ------------------------------------------------------------------ */

interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
}

const ToastContext = createContext<(message: string, tone?: Toast['tone']) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const push = (message: string, tone: Toast['tone'] = 'info'): void => {
    counter.current += 1;
    const id = counter.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 4200);
  };

  const tones = {
    info: 'bg-ink-800 text-white',
    success: 'bg-emerald-600 text-white',
    warning: 'bg-amber-500 text-white',
    danger: 'bg-rose-600 text-white',
  };

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              'pointer-events-auto max-w-md animate-slide-up rounded-xl px-4 py-2.5 text-[13px] font-medium shadow-pop',
              tones[toast.tone],
            )}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
