import { useRef, useState } from 'react';
import { Button, LocaleSwitcher, StatePanel, StatusBadge, Surface } from '../components';
import { directionFor } from '../locale';
import type { Locale } from '../types';
import { catalogCopy, type CatalogCopy, type CatalogRecord } from './copy';
import '../theme.css';
import './catalog.css';

type CatalogFeedback =
  | { kind: 'record'; reference: string }
  | { kind: 'emptyFeedback' | 'errorFeedback' }
  | null;

export function ComponentCatalog({ initialLocale = 'en' }: { initialLocale?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initialLocale);
  const [feedback, setFeedback] = useState<CatalogFeedback>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const copy = catalogCopy[locale];
  const direction = directionFor(locale);

  return (
    <div className="catalog" lang={locale} dir={direction}>
      <a
        className="skip-link"
        href="#catalog-main"
        onClick={(event) => {
          event.preventDefault();
          mainRef.current?.focus();
        }}
      >
        {copy.skipLabel}
      </a>
      <header className="catalog-hero">
        <div>
          <span className="catalog-eyebrow">{copy.eyebrow}</span>
          <h1 ref={titleRef} tabIndex={-1}>
            {copy.title}
          </h1>
          <p>{copy.description}</p>
        </div>
        <LocaleSwitcher
          locale={locale}
          onChange={setLocale}
          englishLabel={copy.englishLabel}
          arabicLabel={copy.arabicLabel}
          groupLabel={copy.localeLabel}
        />
      </header>

      <p className="catalog-disclosure" role="note">
        {copy.fixtureDisclosure}
      </p>

      {feedback && (
        <p className="catalog-feedback" role="status" aria-live="polite">
          {feedback.kind === 'record' ? (
            <>
              {copy.records.openedFeedback}: <TechnicalToken>{feedback.reference}</TechnicalToken>
            </>
          ) : (
            copy.states[feedback.kind]
          )}
        </p>
      )}

      <div className="catalog-layout">
        <nav className="catalog-navigation" aria-label={copy.navigationLabel}>
          <ol>
            {copy.sections.map((section, index) => (
              <li key={section.id}>
                <a href={`#${section.id}`}>
                  <TechnicalToken aria-hidden="true">
                    {String(index + 1).padStart(2, '0')}
                  </TechnicalToken>
                  {section.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main
          id="catalog-main"
          ref={mainRef}
          className="catalog-main"
          aria-label={copy.documentTitle}
          tabIndex={-1}
        >
          <CatalogSection
            id="navigation"
            title={copy.navigation.title}
            description={copy.navigation.description}
          >
            <nav className="catalog-task-navigation" aria-label={copy.navigation.title}>
              <a href="#records" aria-current="page">
                {copy.navigation.activeLabel}
              </a>
              <a href="#approval">{copy.navigation.queueLabel}</a>
              <a href="#audit">{copy.navigation.reportsLabel}</a>
            </nav>
          </CatalogSection>

          <CatalogSection
            id="records"
            title={copy.records.title}
            description={copy.records.description}
          >
            <div
              className="catalog-table-wrap"
              role="region"
              aria-label={copy.records.tableCaption}
              tabIndex={0}
            >
              <table className="catalog-table">
                <caption>{copy.records.tableCaption}</caption>
                <thead>
                  <tr>
                    <th scope="col">{copy.records.columnAccount}</th>
                    <th scope="col">{copy.records.columnStatus}</th>
                    <th scope="col">{copy.records.columnBalance}</th>
                    <th scope="col">{copy.records.columnAction}</th>
                  </tr>
                </thead>
                <tbody>
                  {copy.records.rows.map((record) => (
                    <tr key={record.id}>
                      <th scope="row">
                        <strong>{record.account}</strong>
                        <small>
                          <TechnicalToken>{record.reference}</TechnicalToken>
                        </small>
                      </th>
                      <td>
                        <StatusBadge tone={record.tone}>{record.status}</StatusBadge>
                      </td>
                      <td>
                        <CatalogMoneyPair usd={record.usd} lbp={record.lbp} />
                      </td>
                      <td>
                        <Button
                          variant="tertiary"
                          onClick={() =>
                            setFeedback({ kind: 'record', reference: record.reference })
                          }
                        >
                          {copy.records.openLabel}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="catalog-record-list" aria-label={copy.records.mobileLabel}>
              {copy.records.rows.map((record) => (
                <RecordListItem
                  key={record.id}
                  record={record}
                  openLabel={copy.records.openLabel}
                  onOpen={() => setFeedback({ kind: 'record', reference: record.reference })}
                />
              ))}
            </ul>
          </CatalogSection>

          <CatalogSection
            id="signals"
            title={copy.signals.title}
            description={copy.signals.description}
          >
            <div className="catalog-statuses">
              {copy.signals.statuses.map((status) => (
                <StatusBadge key={status.tone} tone={status.tone}>
                  {status.label}
                </StatusBadge>
              ))}
            </div>
            <div className="catalog-callout" role="note" aria-labelledby="catalog-callout-title">
              <span className="catalog-callout__icon" aria-hidden="true">
                i
              </span>
              <div>
                <h3 id="catalog-callout-title">{copy.signals.calloutTitle}</h3>
                <p>{copy.signals.calloutDescription}</p>
              </div>
            </div>
          </CatalogSection>

          <CatalogSection
            id="approval"
            title={copy.approval.title}
            description={copy.approval.description}
          >
            <CatalogSupportBanner copy={copy.approval} />
            <div className="catalog-approval-grid">
              <Surface className="catalog-approval-card" aria-labelledby="approval-card-title">
                <h3 id="approval-card-title">{copy.approval.cardTitle}</h3>
                <dl>
                  <div>
                    <dt>{copy.approval.impactLabel}</dt>
                    <dd>{copy.approval.impact}</dd>
                  </div>
                  <div>
                    <dt>{copy.approval.reasonLabel}</dt>
                    <dd>{copy.approval.reason}</dd>
                  </div>
                  <div>
                    <dt>{copy.approval.approvalLabel}</dt>
                    <dd>
                      <StatusBadge tone="warning">{copy.approval.approvalState}</StatusBadge>
                    </dd>
                  </div>
                </dl>
                <Button variant="primary" disabled aria-describedby="catalog-approval-unavailable">
                  {copy.approval.approveLabel}
                </Button>
                <p id="catalog-approval-unavailable" className="catalog-unavailable">
                  {copy.approval.approveUnavailableReason}
                </p>
              </Surface>
              <div className="catalog-permission-example">
                <StatePanel
                  variant="denied"
                  title={copy.approval.permissionTitle}
                  description={copy.approval.permissionDescription}
                />
                <p>
                  {copy.approval.requiredScopeLabel}:{' '}
                  <TechnicalToken>{copy.approval.requiredScope}</TechnicalToken>
                </p>
              </div>
            </div>
          </CatalogSection>

          <CatalogSection id="audit" title={copy.audit.title} description={copy.audit.description}>
            <Surface>
              <CatalogAuditList copy={copy.audit} />
            </Surface>
          </CatalogSection>

          <CatalogSection
            id="states"
            title={copy.states.title}
            description={copy.states.description}
          >
            <div className="catalog-states">
              <StatePanel
                variant="loading"
                title={copy.states.loadingTitle}
                description={copy.states.loadingDescription}
              />
              <StatePanel
                variant="empty"
                title={copy.states.emptyTitle}
                description={copy.states.emptyDescription}
                actionLabel={copy.states.emptyAction}
                onAction={() => setFeedback({ kind: 'emptyFeedback' })}
              />
              <StatePanel
                variant="error"
                title={copy.states.errorTitle}
                description={copy.states.errorDescription}
                actionLabel={copy.states.errorAction}
                onAction={() => setFeedback({ kind: 'errorFeedback' })}
              />
              <div className="catalog-denied-example">
                <StatePanel
                  variant="denied"
                  title={copy.states.deniedTitle}
                  description={copy.states.deniedDescription}
                />
                <p>
                  {copy.states.requiredScopeLabel}:{' '}
                  <TechnicalToken>{copy.states.requiredScope}</TechnicalToken>
                </p>
                <Button disabled aria-describedby="catalog-denied-unavailable">
                  {copy.states.deniedAction}
                </Button>
                <p id="catalog-denied-unavailable" className="catalog-unavailable">
                  {copy.states.deniedUnavailableReason}
                </p>
              </div>
            </div>
          </CatalogSection>

          <CatalogSection
            id="behavior"
            title={copy.behavior.title}
            description={copy.behavior.description}
          >
            <div className="catalog-behavior-grid">
              <Surface className="catalog-behavior-card">
                <h3>{copy.behavior.keyboardTitle}</h3>
                <p>{copy.behavior.keyboardDescription}</p>
                <Button variant="secondary" onClick={() => titleRef.current?.focus()}>
                  {copy.behavior.focusLabel}
                </Button>
              </Surface>
              <Surface className="catalog-behavior-card catalog-motion-sample">
                <span aria-hidden="true" />
                <div>
                  <h3>{copy.behavior.motionTitle}</h3>
                  <p>{copy.behavior.motionDescription}</p>
                </div>
              </Surface>
            </div>
          </CatalogSection>
        </main>
      </div>
    </div>
  );
}

function CatalogSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <section className="catalog-section" id={id} aria-labelledby={`${id}-title`}>
      <div className="catalog-section__header">
        <h2 id={`${id}-title`}>{title}</h2>
        <p>{description}</p>
      </div>
      {children}
    </section>
  );
}

function RecordListItem({
  record,
  openLabel,
  onOpen,
}: {
  record: CatalogRecord;
  openLabel: string;
  onOpen: () => void;
}) {
  return (
    <li>
      <div className="catalog-record-list__header">
        <span>
          <strong>{record.account}</strong>
          <small>
            <TechnicalToken>{record.reference}</TechnicalToken>
          </small>
        </span>
        <StatusBadge tone={record.tone}>{record.status}</StatusBadge>
      </div>
      <CatalogMoneyPair usd={record.usd} lbp={record.lbp} />
      <Button variant="tertiary" onClick={onOpen}>
        {openLabel}
      </Button>
    </li>
  );
}

function TechnicalToken({
  children,
  ...props
}: React.HTMLAttributes<HTMLElement> & { children: React.ReactNode }) {
  return (
    <bdi {...props} className="catalog-technical-token" dir="ltr">
      {children}
    </bdi>
  );
}

function CatalogMoneyPair({ usd, lbp }: { usd: string; lbp: string }) {
  return (
    <span className="money-pair">
      <span>
        <small>
          <TechnicalToken>USD</TechnicalToken>
        </small>
        <strong>
          <TechnicalToken>{usd}</TechnicalToken>
        </strong>
      </span>
      <span>
        <small>
          <TechnicalToken>LBP</TechnicalToken>
        </small>
        <strong>
          <TechnicalToken>{lbp}</TechnicalToken>
        </strong>
      </span>
    </span>
  );
}

function CatalogSupportBanner({ copy }: { copy: CatalogCopy['approval'] }) {
  return (
    <section className="support-banner" aria-labelledby="catalog-support-session-title">
      <div className="support-banner__signal" aria-hidden="true">
        <span />
      </div>
      <div className="support-banner__copy">
        <div className="support-banner__heading">
          <strong id="catalog-support-session-title">{copy.supportTitle}</strong>
          <span>{copy.auditLabel}</span>
        </div>
        <p>{copy.supportDescription}</p>
        <dl>
          <div>
            <dt>{copy.ticketLabel}</dt>
            <dd>
              <TechnicalToken>{copy.ticket}</TechnicalToken>
            </dd>
          </div>
          <div>
            <dt>{copy.scopeLabel}</dt>
            <dd>{copy.scope}</dd>
          </div>
          <div>
            <dt>{copy.expiresLabel}</dt>
            <dd>{copy.expires}</dd>
          </div>
        </dl>
      </div>
      <div className="catalog-support-action">
        <Button disabled aria-describedby="catalog-support-unavailable" variant="tertiary">
          {copy.endLabel}
        </Button>
        <span id="catalog-support-unavailable" className="catalog-unavailable">
          {copy.unavailableLabel}
        </span>
      </div>
    </section>
  );
}

function CatalogAuditList({ copy }: { copy: CatalogCopy['audit'] }) {
  return (
    <ol className="activity-list">
      {copy.items.map((item) => (
        <li key={`${item.reference}-${item.time}`}>
          <span
            className={`activity-list__marker activity-list__marker--${item.tone}`}
            aria-hidden="true"
          />
          <span className="activity-list__copy">
            <strong>{item.title}</strong>
            <small>
              {copy.actorLabel}: {item.actor} · {copy.referenceLabel}:{' '}
              <TechnicalToken>{item.reference}</TechnicalToken> · {copy.outcomeLabel}:{' '}
              {item.outcome}
            </small>
          </span>
          <time>
            <TechnicalToken>{item.time}</TechnicalToken>{' '}
            <TechnicalToken>{item.timeZone}</TechnicalToken>
          </time>
        </li>
      ))}
    </ol>
  );
}
