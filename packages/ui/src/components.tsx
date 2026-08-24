import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useDocumentLocale } from './locale';
import type {
  DrilldownItem,
  Locale,
  NavigationItem,
  ShellContext,
  TaskRouteDefinition,
  Tone,
} from './types';

function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function BrandMark({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <span className={cn('brand', compact && 'brand--compact')}>
      <svg className="brand__mark" viewBox="0 0 48 48" role="img" aria-label={label}>
        <circle cx="24" cy="24" r="15" />
        <path d="M15 28c4.5-9 13.5-9 18-1" />
        <path d="m30 18 5 1-1 5" />
        <circle cx="15" cy="28" r="2.2" />
        <circle cx="33" cy="27" r="2.2" />
      </svg>
      {!compact && (
        <span className="brand__wordmark" aria-hidden="true">
          <span>ORVEX</span>
          <small>ISP</small>
        </span>
      )}
    </span>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';

export function Button({
  className,
  variant = 'secondary',
  isLoading = false,
  loadingLabel,
  permissionBlocked = false,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  isLoading?: boolean;
  loadingLabel?: string;
  permissionBlocked?: boolean;
}) {
  const isDisabled = disabled || isLoading || permissionBlocked;
  return (
    <button
      className={cn('button', `button--${variant}`, isLoading && 'is-loading', className)}
      disabled={isDisabled}
      aria-disabled={isDisabled || undefined}
      aria-busy={isLoading || undefined}
      title={permissionBlocked ? props.title : undefined}
      {...props}
    >
      {isLoading && <span className="button__spinner" aria-hidden="true" />}
      <span>{isLoading ? (loadingLabel ?? children) : children}</span>
    </button>
  );
}

export function LocaleSwitcher({
  locale,
  onChange,
  englishLabel,
  arabicLabel,
  groupLabel,
}: {
  locale: Locale;
  onChange: (locale: Locale) => void;
  englishLabel: string;
  arabicLabel: string;
  groupLabel: string;
}) {
  return (
    <div className="locale-switcher" role="group" aria-label={groupLabel}>
      <button type="button" aria-pressed={locale === 'en'} onClick={() => onChange('en')} lang="en">
        {englishLabel}
      </button>
      <button type="button" aria-pressed={locale === 'ar'} onClick={() => onChange('ar')} lang="ar">
        {arabicLabel}
      </button>
    </div>
  );
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={cn('status-badge', `status-badge--${tone}`)}>
      <span className="status-badge__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function AppShell({
  locale,
  brandLabel,
  productName,
  navLabel,
  menuLabel,
  closeMenuLabel,
  skipLabel,
  navigation,
  activeNavigationId,
  onNavigate,
  context,
  contextAction,
  commandLabel,
  toolbar,
  supportBanner,
  children,
}: {
  locale: Locale;
  brandLabel: string;
  productName: string;
  navLabel: string;
  menuLabel: string;
  closeMenuLabel: string;
  skipLabel: string;
  navigation: NavigationItem[];
  activeNavigationId: string;
  onNavigate: (id: string) => void;
  context: ShellContext;
  contextAction?: ReactNode;
  commandLabel?: string;
  toolbar?: ReactNode;
  supportBanner?: ReactNode;
  children: ReactNode;
}) {
  useDocumentLocale(locale);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileViewport, setMobileViewport] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState('');
  const [commandIndex, setCommandIndex] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const navigationRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);
  const wasMobileOpen = useRef(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 1024px)');
    const updateViewport = () => {
      setMobileViewport(media.matches);
      if (!media.matches) setMobileOpen(false);
    };
    updateViewport();
    media.addEventListener('change', updateViewport);
    return () => media.removeEventListener('change', updateViewport);
  }, []);

  useEffect(() => {
    if (!mobileViewport) return;
    if (!mobileOpen) {
      if (wasMobileOpen.current) menuButtonRef.current?.focus({ preventScroll: true });
      wasMobileOpen.current = false;
      return;
    }

    wasMobileOpen.current = true;
    const navigationElement = navigationRef.current;
    const focusable =
      navigationElement?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    focusable?.[0]?.focus({ preventScroll: true });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }
      if (event.key !== 'Tab' || !focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [mobileOpen, mobileViewport]);

  useEffect(() => {
    setMobileOpen(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [activeNavigationId]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setCommandOpen(true);
      }
      if (event.key === 'Escape') setCommandOpen(false);
    };
    document.addEventListener('keydown', handleShortcut);
    return () => document.removeEventListener('keydown', handleShortcut);
  }, []);

  useEffect(() => {
    if (!commandOpen) return;
    setCommandQuery('');
    setCommandIndex(0);
    requestAnimationFrame(() => commandInputRef.current?.focus());
  }, [commandOpen]);

  const normalizedQuery = commandQuery.trim().toLocaleLowerCase(locale);
  const commandResults = navigation.filter((item) =>
    item.label.toLocaleLowerCase(locale).includes(normalizedQuery),
  );
  const openCommand = (id: string) => {
    onNavigate(id);
    setCommandOpen(false);
  };
  const commandCopy =
    locale === 'ar'
      ? {
          title: 'انتقل إلى أي مساحة',
          placeholder: 'ابحث في الوحدات والمهام…',
          empty: 'لا توجد مساحة مطابقة. جرّب عبارة أقصر.',
          current: 'الحالية',
          open: 'فتح',
          close: 'إغلاق البحث السريع',
          hint: 'للتنقّل',
        }
      : {
          title: 'Go anywhere',
          placeholder: 'Search modules and workspaces…',
          empty: 'No matching workspace. Try a shorter phrase.',
          current: 'Current',
          open: 'Open',
          close: 'Close quick search',
          hint: 'to navigate',
        };

  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
        inert={mobileViewport && mobileOpen}
        aria-hidden={mobileViewport && mobileOpen ? true : undefined}
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        {skipLabel}
      </a>
      <div
        className="app-shell"
        inert={commandOpen ? true : undefined}
        aria-hidden={commandOpen ? true : undefined}
      >
        <aside
          className={cn('side-navigation', mobileOpen && 'is-open')}
          id="primary-navigation"
          ref={navigationRef}
          inert={mobileViewport && !mobileOpen}
          aria-hidden={mobileViewport && !mobileOpen ? true : undefined}
        >
          <div className="side-navigation__brand">
            <BrandMark label={brandLabel} />
            <span className="side-navigation__product">{productName}</span>
          </div>
          <nav aria-label={navLabel}>
            <ul>
              {navigation.map((item, index) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onNavigate(item.id);
                      setMobileOpen(false);
                    }}
                    aria-current={activeNavigationId === item.id ? 'page' : undefined}
                  >
                    <span className="side-navigation__index" aria-hidden="true">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <span className="side-navigation__label">{item.label}</span>
                    {item.badge && <span className="side-navigation__badge">{item.badge}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
          <div className="side-navigation__footer">
            <span>Asia/Beirut</span>
          </div>
        </aside>

        {mobileOpen && (
          <button
            className="navigation-scrim"
            type="button"
            aria-hidden="true"
            tabIndex={-1}
            title={closeMenuLabel}
            onClick={() => setMobileOpen(false)}
          />
        )}

        <div
          className="app-shell__canvas"
          inert={mobileViewport && mobileOpen}
          aria-hidden={mobileViewport && mobileOpen ? true : undefined}
        >
          <header className="context-header">
            <button
              ref={menuButtonRef}
              className="menu-button"
              type="button"
              aria-label={menuLabel}
              aria-controls="primary-navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen((value) => !value)}
            >
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>
            <div className="context-header__identity">
              <span className="context-header__eyebrow">{context.eyebrow}</span>
              <div className="context-header__title-row">
                <strong>{context.title}</strong>
                {contextAction}
              </div>
              <span className="context-header__meta">{context.meta}</span>
            </div>
            <div className="context-header__toolbar">
              {commandLabel && (
                <button
                  type="button"
                  className="command-trigger"
                  aria-label={commandLabel}
                  onClick={() => setCommandOpen(true)}
                >
                  <span aria-hidden="true">⌕</span>
                  <kbd aria-hidden="true">Ctrl K</kbd>
                </button>
              )}
              {toolbar}
            </div>
          </header>
          {supportBanner}
          <main id="main-content" className="workspace" tabIndex={-1} ref={mainRef}>
            {children}
          </main>
        </div>
      </div>
      {commandOpen && (
        <div
          className="command-layer"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCommandOpen(false);
          }}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-modal="true"
            aria-labelledby="command-palette-title"
          >
            <header className="command-palette__header">
              <span className="command-palette__mark" aria-hidden="true">
                ⌕
              </span>
              <div>
                <h2 id="command-palette-title">{commandCopy.title}</h2>
                <p>{productName}</p>
              </div>
              <button
                type="button"
                className="command-palette__close"
                aria-label={commandCopy.close}
                onClick={() => setCommandOpen(false)}
              >
                Esc
              </button>
            </header>
            <input
              ref={commandInputRef}
              type="search"
              className="command-palette__input"
              aria-label={commandLabel}
              placeholder={commandCopy.placeholder}
              value={commandQuery}
              onChange={(event) => {
                setCommandQuery(event.target.value);
                setCommandIndex(0);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setCommandIndex((value) =>
                    commandResults.length ? (value + 1) % commandResults.length : 0,
                  );
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setCommandIndex((value) =>
                    commandResults.length
                      ? (value - 1 + commandResults.length) % commandResults.length
                      : 0,
                  );
                } else if (event.key === 'Enter' && commandResults[commandIndex]) {
                  event.preventDefault();
                  openCommand(commandResults[commandIndex].id);
                }
              }}
            />
            <div className="command-palette__results" role="listbox" aria-label={commandCopy.title}>
              {commandResults.map((item, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={index === commandIndex}
                  className={cn(index === commandIndex && 'is-active')}
                  key={item.id}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => openCommand(item.id)}
                >
                  <span className="command-palette__route-index" aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    <small>
                      {item.id === activeNavigationId ? commandCopy.current : commandCopy.open}
                    </small>
                  </span>
                  <span aria-hidden="true">↗</span>
                </button>
              ))}
              {!commandResults.length && (
                <p className="command-palette__empty">{commandCopy.empty}</p>
              )}
            </div>
            <footer className="command-palette__footer">
              <span>
                <kbd>↑</kbd>
                <kbd>↓</kbd> {commandCopy.hint}
              </span>
              <span>
                <kbd>↵</kbd> {commandCopy.open}
              </span>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

export function SupportSessionBanner({
  title,
  description,
  ticketLabel,
  ticket,
  scopeLabel,
  scope,
  expiresLabel,
  expires,
  auditLabel,
  endLabel,
  onEnd,
}: {
  title: string;
  description: string;
  ticketLabel: string;
  ticket: string;
  scopeLabel: string;
  scope: string;
  expiresLabel: string;
  expires: string;
  auditLabel: string;
  endLabel: string;
  onEnd?: () => void;
}) {
  return (
    <section className="support-banner" aria-labelledby="support-session-title">
      <div className="support-banner__signal" aria-hidden="true">
        <span />
      </div>
      <div className="support-banner__copy">
        <div className="support-banner__heading">
          <strong id="support-session-title">{title}</strong>
          <span>{auditLabel}</span>
        </div>
        <p>{description}</p>
        <dl>
          <div>
            <dt>{ticketLabel}</dt>
            <dd>{ticket}</dd>
          </div>
          <div>
            <dt>{scopeLabel}</dt>
            <dd>{scope}</dd>
          </div>
          <div>
            <dt>{expiresLabel}</dt>
            <dd>{expires}</dd>
          </div>
        </dl>
      </div>
      {onEnd && (
        <Button variant="tertiary" onClick={onEnd}>
          {endLabel}
        </Button>
      )}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        <span className="page-header__eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function SectionHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="section-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function KpiCard({
  label,
  value,
  detail,
  trend,
  trendLabel,
  tone = 'primary',
  targetLabel,
  onOpen,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  trend?: string;
  trendLabel?: string;
  tone?: Tone;
  targetLabel: string;
  onOpen: () => void;
}) {
  return (
    <button className={cn('kpi-card', `kpi-card--${tone}`)} type="button" onClick={onOpen}>
      <span className="kpi-card__topline">
        <span className="kpi-card__label">{label}</span>
        <span className="kpi-card__arrow" aria-hidden="true">
          ↗
        </span>
      </span>
      <div className="kpi-card__value">{value}</div>
      <span className="kpi-card__detail">{detail}</span>
      {trend && (
        <span className="kpi-card__trend">
          <strong>{trend}</strong> {trendLabel}
        </span>
      )}
      <span className="sr-only">{targetLabel}</span>
    </button>
  );
}

export function MoneyPair({
  usd,
  lbp,
  usdLabel = 'USD',
  lbpLabel = 'LBP',
}: {
  usd: string;
  lbp: string;
  usdLabel?: string;
  lbpLabel?: string;
}) {
  return (
    <span className="money-pair">
      <span>
        <small>{usdLabel}</small>
        <strong dir="ltr">{usd}</strong>
      </span>
      <span>
        <small>{lbpLabel}</small>
        <strong dir="ltr">{lbp}</strong>
      </span>
    </span>
  );
}

export function DrilldownPanel({
  title,
  filterLabel,
  items,
  closeLabel,
  onClose,
}: {
  title: string;
  filterLabel: string;
  items: DrilldownItem[];
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <section className="drilldown-panel" aria-labelledby="drilldown-title">
      <div className="drilldown-panel__header">
        <div>
          <span>{filterLabel}</span>
          <h2 id="drilldown-title">{title}</h2>
        </div>
        <button type="button" onClick={onClose} aria-label={closeLabel}>
          ×
        </button>
      </div>
      <ul>
        {items.map((item) => (
          <li key={`${item.label}-${item.value}`}>
            <span>
              <strong>{item.label}</strong>
              {item.detail && <small>{item.detail}</small>}
            </span>
            <StatusBadge tone={item.tone}>{item.value}</StatusBadge>
          </li>
        ))}
      </ul>
    </section>
  );
}

export type StateVariant = 'loading' | 'empty' | 'error' | 'denied';

export function StatePanel({
  variant,
  title,
  description,
  actionLabel,
  onAction,
}: {
  variant: StateVariant;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  if (variant === 'loading') {
    return (
      <section className="state-panel state-panel--loading" aria-live="polite" aria-busy="true">
        <span className="state-panel__loader" aria-hidden="true" />
        <div>
          <h3>{title}</h3>
          <p>{description}</p>
        </div>
        <div className="skeleton-lines" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </section>
    );
  }

  return (
    <section
      className={cn('state-panel', `state-panel--${variant}`)}
      role={variant === 'error' ? 'alert' : undefined}
    >
      <span className="state-panel__icon" aria-hidden="true">
        {variant === 'empty' ? '○' : variant === 'error' ? '!' : '×'}
      </span>
      <div>
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
      {actionLabel && onAction && (
        <Button variant={variant === 'error' ? 'primary' : 'secondary'} onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </section>
  );
}

export function SegmentedControl({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; label: string }>;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="segmented-control" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          type="button"
          key={option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Surface({ className, children, ...props }: HTMLAttributes<HTMLElement>) {
  return (
    <section className={cn('surface', className)} {...props}>
      {children}
    </section>
  );
}

export function ActivityList({
  items,
}: {
  items: Array<{ title: string; detail: string; time: string; tone?: Tone }>;
}) {
  return (
    <ol className="activity-list">
      {items.map((item) => (
        <li key={`${item.title}-${item.time}`}>
          <span
            className={cn(
              'activity-list__marker',
              `activity-list__marker--${item.tone ?? 'neutral'}`,
            )}
            aria-hidden="true"
          />
          <span className="activity-list__copy">
            <strong>{item.title}</strong>
            <small>{item.detail}</small>
          </span>
          <time>{item.time}</time>
        </li>
      ))}
    </ol>
  );
}

export function QuickAction({
  label,
  description,
  onClick,
}: {
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className="quick-action" onClick={onClick}>
      <span className="quick-action__plus" aria-hidden="true">
        +
      </span>
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <span className="quick-action__arrow" aria-hidden="true">
        →
      </span>
    </button>
  );
}

export function TaskRouteView({
  route,
  dataSourceLabel,
  onNavigate,
}: {
  route: TaskRouteDefinition;
  dataSourceLabel: string;
  onNavigate: (id: string) => void;
}) {
  return (
    <>
      <div className="route-disclosure">
        <StatusBadge tone="neutral">{dataSourceLabel}</StatusBadge>
      </div>
      <PageHeader eyebrow={route.eyebrow} title={route.title} description={route.description} />
      <div className="route-metrics" aria-label={route.title}>
        {route.metrics.map((metric) => (
          <article className="surface route-metric" key={metric.label}>
            <h2>{metric.label}</h2>
            <strong dir="auto">{metric.value}</strong>
            <small>{metric.detail}</small>
            <StatusBadge tone={metric.tone}>{metric.status}</StatusBadge>
          </article>
        ))}
      </div>
      <div className="route-workspace">
        <Surface>
          <div className="surface__header">
            <div>
              <h2>{route.queueTitle}</h2>
              <p>{route.queueDescription}</p>
            </div>
            <StatusBadge tone="neutral">{String(route.queue.length)}</StatusBadge>
          </div>
          <ul className="route-queue">
            {route.queue.map((item) => (
              <li key={`${item.label}-${item.value}`}>
                <span>
                  <strong>{item.label}</strong>
                  {item.detail && <small>{item.detail}</small>}
                </span>
                <StatusBadge tone={item.tone}>{item.value}</StatusBadge>
              </li>
            ))}
          </ul>
        </Surface>
        <Surface>
          <div className="surface__header">
            <div>
              <h2>{route.nextTitle}</h2>
              <p>{route.nextDescription}</p>
            </div>
          </div>
          <div className="quick-actions">
            {route.actions.map((action) => (
              <QuickAction
                key={`${action.targetId}-${action.label}`}
                label={action.label}
                description={action.description}
                onClick={() => onNavigate(action.targetId)}
              />
            ))}
          </div>
        </Surface>
      </div>
    </>
  );
}
