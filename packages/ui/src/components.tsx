import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useDocumentLocale } from './locale';
import type { DrilldownItem, Locale, NavigationItem, ShellContext, Tone } from './types';

function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

export function BrandMark({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <span className={cn('brand', compact && 'brand--compact')}>
      <svg className="brand__mark" viewBox="0 0 48 48" role="img" aria-label={label}>
        <path d="M24 5v37" />
        <path d="M24 10 12 21h8L9 31h11L14 39h20l-6-8h11L28 21h8L24 10Z" />
        <circle cx="24" cy="6" r="2.5" />
        <circle cx="10" cy="31" r="2" />
        <circle cx="38" cy="31" r="2" />
      </svg>
      {!compact && (
        <span className="brand__wordmark" aria-hidden="true">
          <span>CEDAR</span>
          <small>OPS</small>
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
  toolbar?: ReactNode;
  supportBanner?: ReactNode;
  children: ReactNode;
}) {
  useDocumentLocale(locale);
  const [mobileOpen, setMobileOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);

  useEffect(() => {
    setMobileOpen(false);
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.focus({ preventScroll: true });
  }, [activeNavigationId]);

  return (
    <>
      <a className="skip-link" href="#main-content">
        {skipLabel}
      </a>
      <div className="app-shell">
        <aside className={cn('side-navigation', mobileOpen && 'is-open')} id="primary-navigation">
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
                    onClick={() => onNavigate(item.id)}
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
            <span className="live-indicator" aria-hidden="true" />
            <span>Asia/Beirut</span>
          </div>
        </aside>

        {mobileOpen && (
          <button
            className="navigation-scrim"
            type="button"
            aria-label={closeMenuLabel}
            onClick={() => setMobileOpen(false)}
          />
        )}

        <div className="app-shell__canvas">
          <header className="context-header">
            <button
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
            <div className="context-header__toolbar">{toolbar}</div>
          </header>
          {supportBanner}
          <main id="main-content" className="workspace" tabIndex={-1} ref={mainRef}>
            {children}
          </main>
        </div>
      </div>
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
