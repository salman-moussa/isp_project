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
  const titleId = useId();

  const apply = (event: FormEvent) => {
    event.preventDefault();
    props.onApplyFilters(filters);
  };
  const reset = () => {
    setFilters(initialFilters);
    props.onApplyFilters(initialFilters);
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
            onClick={props.onAddClient}
          >
            {copy.add}
          </button>
        )}
      </header>

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
