import { useId, useState, type FormEvent } from 'react';
import { controlCenterCopy, type ControlCenterLocale } from './copy';
import './control-center.css';

export type ControlCenterViewState = 'ready' | 'loading' | 'empty' | 'error' | 'denied' | 'success';

export interface ControlCenterClientRow {
  readonly id: string;
  readonly tradingName: string;
  readonly legalName: string;
  readonly state: 'lead' | 'trial' | 'active' | 'grace' | 'restricted' | 'terminated' | 'archived';
  readonly packageName: string;
  readonly deploymentHealth: 'healthy' | 'attention' | 'blocked' | 'unknown';
  readonly supportStatus: 'clear' | 'open' | 'escalated' | 'unknown';
  readonly openTicketCount: number;
}

export interface ControlCenterFilters {
  readonly query: string;
  readonly state: string;
  readonly deploymentHealth: string;
  readonly supportStatus: string;
}

export interface ControlCenterWorkspaceProps {
  readonly locale: ControlCenterLocale;
  readonly viewState: ControlCenterViewState;
  readonly clients: readonly ControlCenterClientRow[];
  readonly onApplyFilters: (filters: ControlCenterFilters) => void;
  readonly onOpenClient: (clientId: string) => void;
  readonly onAddClient: () => void;
  readonly onCreateClient?: (
    input: {
      readonly tenantId: string;
      readonly legalName: string;
      readonly tradingName: string;
      readonly registrationNumber?: string;
      readonly accountOwnerId?: string;
      readonly notes?: string;
      readonly reason: string;
    },
    idempotencyKey: string,
  ) => Promise<void>;
  readonly canAddClient?: boolean;
  readonly onRetry: () => void;
  readonly onOpenAudit: () => void;
}

const initialFilters: ControlCenterFilters = {
  query: '',
  state: '',
  deploymentHealth: '',
  supportStatus: '',
};

export function ControlCenterWorkspace(props: ControlCenterWorkspaceProps) {
  const copy = controlCenterCopy[props.locale];
  const [filters, setFilters] = useState(initialFilters);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string>();
  const titleId = useId();

  const apply = (event: FormEvent) => {
    event.preventDefault();
    props.onApplyFilters(filters);
  };
  const reset = () => {
    setFilters(initialFilters);
    props.onApplyFilters(initialFilters);
  };
  const createClient = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!props.onCreateClient) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const value = (name: string) => {
      const entry = data.get(name);
      return typeof entry === 'string' ? entry.trim() : '';
    };
    setCreating(true);
    setCreateError(undefined);
    try {
      await props.onCreateClient(
        {
          tenantId: value('tenantId'),
          legalName: value('legalName'),
          tradingName: value('tradingName'),
          ...(value('registrationNumber')
            ? { registrationNumber: value('registrationNumber') }
            : {}),
          ...(value('accountOwnerId') ? { accountOwnerId: value('accountOwnerId') } : {}),
          ...(value('notes') ? { notes: value('notes') } : {}),
          reason: value('reason'),
        },
        `web-client-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`,
      );
      form.reset();
      setShowCreate(false);
    } catch (caught) {
      setCreateError(caught instanceof Error ? caught.message : 'The client could not be created.');
    } finally {
      setCreating(false);
    }
  };
  const createLabels =
    props.locale === 'en'
      ? {
          title: 'Add ISP client',
          description:
            'Create the isolated client identity before contacts, package assignment and deployment.',
          tenantId: 'Tenant ID',
          legalName: 'Legal name',
          tradingName: 'Trading name',
          registration: 'Registration number (optional)',
          owner: 'Account owner ID (optional)',
          notes: 'Internal notes (optional)',
          reason: 'Business reason',
          cancel: 'Cancel',
          save: 'Create client',
          saving: 'Creating…',
        }
      : {
          title: 'إضافة عميل مزوّد إنترنت',
          description: 'أنشئ هوية العميل المعزولة قبل جهات الاتصال وتعيين الباقة والنشر.',
          tenantId: 'معرّف مساحة العمل',
          legalName: 'الاسم القانوني',
          tradingName: 'الاسم التجاري',
          registration: 'رقم التسجيل (اختياري)',
          owner: 'معرّف مسؤول الحساب (اختياري)',
          notes: 'ملاحظات داخلية (اختياري)',
          reason: 'سبب الإجراء',
          cancel: 'إلغاء',
          save: 'إنشاء العميل',
          saving: 'جارٍ الإنشاء…',
        };

  return (
    <section
      className="cc-workspace"
      dir={props.locale === 'ar' ? 'rtl' : 'ltr'}
      aria-labelledby={titleId}
    >
      <header className="cc-workspace__header">
        <div>
          <p className="cc-workspace__eyebrow">{copy.eyebrow}</p>
          <h1 id={titleId}>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
        {props.viewState !== 'denied' && props.canAddClient !== false && (
          <button
            className="cc-button cc-button--primary"
            type="button"
            onClick={() => {
              if (props.onCreateClient) setShowCreate((current) => !current);
              else props.onAddClient();
            }}
          >
            {copy.add}
          </button>
        )}
      </header>

      {showCreate ? (
        <form className="cc-create" onSubmit={(event) => void createClient(event)}>
          <div className="cc-create__heading">
            <div>
              <h2>{createLabels.title}</h2>
              <p>{createLabels.description}</p>
            </div>
            <button className="cc-link" type="button" onClick={() => setShowCreate(false)}>
              {createLabels.cancel}
            </button>
          </div>
          <div className="cc-create__grid">
            <label className="cc-field">
              <span>{createLabels.tenantId}</span>
              <input
                name="tenantId"
                required
                pattern="[0-9a-fA-F-]{36}"
                defaultValue={globalThis.crypto?.randomUUID?.() ?? ''}
              />
            </label>
            <label className="cc-field">
              <span>{createLabels.legalName}</span>
              <input name="legalName" required minLength={2} maxLength={200} />
            </label>
            <label className="cc-field">
              <span>{createLabels.tradingName}</span>
              <input name="tradingName" required minLength={2} maxLength={200} />
            </label>
            <label className="cc-field">
              <span>{createLabels.registration}</span>
              <input name="registrationNumber" maxLength={100} />
            </label>
            <label className="cc-field">
              <span>{createLabels.owner}</span>
              <input name="accountOwnerId" maxLength={128} />
            </label>
            <label className="cc-field cc-field--wide">
              <span>{createLabels.notes}</span>
              <textarea name="notes" rows={3} maxLength={2000} />
            </label>
            <label className="cc-field cc-field--wide">
              <span>{createLabels.reason}</span>
              <textarea name="reason" rows={2} required minLength={8} maxLength={500} />
            </label>
          </div>
          {createError ? (
            <p className="cc-create__error" role="alert">
              {createError}
            </p>
          ) : null}
          <button className="cc-button cc-button--primary" type="submit" disabled={creating}>
            {creating ? createLabels.saving : createLabels.save}
          </button>
        </form>
      ) : null}

      <form className="cc-filters" onSubmit={apply} aria-label={copy.table}>
        <label className="cc-field cc-field--search">
          <span>{copy.search}</span>
          <input
            type="search"
            value={filters.query}
            maxLength={120}
            onChange={(event) => setFilters({ ...filters, query: event.target.value })}
          />
        </label>
        <FilterSelect
          label={copy.state}
          allLabel={copy.all}
          value={filters.state}
          options={['lead', 'trial', 'active', 'grace', 'restricted', 'terminated', 'archived']}
          labels={copy.statusLabels}
          onChange={(state) => setFilters({ ...filters, state })}
        />
        <FilterSelect
          label={copy.health}
          allLabel={copy.all}
          value={filters.deploymentHealth}
          options={['healthy', 'attention', 'blocked']}
          labels={copy.statusLabels}
          onChange={(deploymentHealth) => setFilters({ ...filters, deploymentHealth })}
        />
        <FilterSelect
          label={copy.support}
          allLabel={copy.all}
          value={filters.supportStatus}
          options={['clear', 'open', 'escalated']}
          labels={copy.statusLabels}
          onChange={(supportStatus) => setFilters({ ...filters, supportStatus })}
        />
        <div className="cc-filters__actions">
          <button className="cc-button cc-button--primary" type="submit">
            {copy.apply}
          </button>
          <button className="cc-button" type="button" onClick={reset}>
            {copy.reset}
          </button>
        </div>
      </form>

      {props.viewState === 'ready' ? (
        <div className="cc-results">
          <div className="cc-results__heading">
            <h2>{copy.table}</h2>
            <span aria-live="polite">{copy.resultCount(props.clients.length)}</span>
          </div>
          <div className="cc-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{copy.client}</th>
                  <th>{copy.lifecycle}</th>
                  <th>{copy.package}</th>
                  <th>{copy.deployment}</th>
                  <th>{copy.tickets}</th>
                  <th>{copy.action}</th>
                </tr>
              </thead>
              <tbody>
                {props.clients.map((client) => (
                  <tr key={client.id}>
                    <td data-label={copy.client}>
                      <strong>{client.tradingName}</strong>
                      <small>{client.legalName}</small>
                    </td>
                    <td data-label={copy.lifecycle}>
                      <Status
                        value={client.state}
                        label={copy.statusLabels[client.state] ?? client.state}
                      />
                    </td>
                    <td data-label={copy.package}>{client.packageName}</td>
                    <td data-label={copy.deployment}>
                      <Status
                        value={client.deploymentHealth}
                        label={
                          copy.statusLabels[client.deploymentHealth] ?? client.deploymentHealth
                        }
                      />
                    </td>
                    <td data-label={copy.tickets}>
                      <Status
                        value={client.supportStatus}
                        label={copy.statusLabels[client.supportStatus] ?? client.supportStatus}
                      />{' '}
                      <span>{client.openTicketCount}</span>
                    </td>
                    <td data-label={copy.action}>
                      <button
                        className="cc-link"
                        type="button"
                        onClick={() => props.onOpenClient(client.id)}
                      >
                        {copy.open}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <TaskState
          state={props.viewState}
          copy={copy}
          onRetry={props.onRetry}
          onReset={reset}
          onAudit={props.onOpenAudit}
        />
      )}
    </section>
  );
}

function FilterSelect(props: {
  readonly label: string;
  readonly allLabel: string;
  readonly value: string;
  readonly options: readonly string[];
  readonly labels: Readonly<Record<string, string>>;
  readonly onChange: (value: string) => void;
}) {
  return (
    <label className="cc-field">
      <span>{props.label}</span>
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        <option value="">{props.allLabel}</option>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {props.labels[option] ?? option}
          </option>
        ))}
      </select>
    </label>
  );
}

function Status({ value, label }: { readonly value: string; readonly label: string }) {
  const tone = ['active', 'healthy', 'clear'].includes(value)
    ? 'positive'
    : ['restricted', 'terminated', 'blocked', 'escalated'].includes(value)
      ? 'critical'
      : 'warning';
  return <span className={`cc-status cc-status--${tone}`}>{label}</span>;
}

function TaskState(props: {
  readonly state: Exclude<ControlCenterViewState, 'ready'>;
  readonly copy: (typeof controlCenterCopy)[ControlCenterLocale];
  readonly onRetry: () => void;
  readonly onReset: () => void;
  readonly onAudit: () => void;
}) {
  const values = {
    loading: [props.copy.loadingTitle, props.copy.loadingBody],
    empty: [props.copy.emptyTitle, props.copy.emptyBody],
    error: [props.copy.errorTitle, props.copy.errorBody],
    denied: [props.copy.denialTitle, props.copy.denialBody],
    success: [props.copy.successTitle, props.copy.successBody],
  } as const;
  const [title, body] = values[props.state];
  return (
    <div
      className={`cc-task-state cc-task-state--${props.state}`}
      role={props.state === 'error' ? 'alert' : 'status'}
      aria-live="polite"
    >
      <span className="cc-task-state__mark" aria-hidden="true" /> <h2>{title}</h2>
      <p>{body}</p>
      {props.state === 'error' && (
        <button className="cc-button" type="button" onClick={props.onRetry}>
          {props.copy.retry}
        </button>
      )}
      {props.state === 'empty' && (
        <button className="cc-button" type="button" onClick={props.onReset}>
          {props.copy.clear}
        </button>
      )}
      {props.state === 'success' && (
        <button className="cc-button" type="button" onClick={props.onAudit}>
          {props.copy.audit}
        </button>
      )}
    </div>
  );
}
