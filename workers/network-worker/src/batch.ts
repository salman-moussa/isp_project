import type { NetworkAction, RouterId, SubscriberServiceId, TenantId } from './domain.js';

export interface BulkCandidate {
  readonly subscriberServiceId: SubscriberServiceId;
  readonly routerId: RouterId;
  readonly areaId: string;
  readonly packageId: string;
  readonly currentActionAllowed: boolean;
  readonly exclusionReason?: string;
}

export type BulkSelection =
  | { readonly type: 'selected'; readonly subscriberServiceIds: readonly SubscriberServiceId[] }
  | { readonly type: 'area'; readonly areaId: string }
  | { readonly type: 'package'; readonly packageId: string };

export interface BulkImpactPreview {
  readonly tenantId: TenantId;
  readonly selection: BulkSelection;
  readonly actionKind: NetworkAction['kind'];
  readonly included: readonly Readonly<BulkCandidate>[];
  readonly excluded: readonly Readonly<BulkCandidate>[];
  readonly generatedAt: string;
  readonly digest: string;
}

export interface ImmutableBulkBatch extends BulkImpactPreview {
  readonly batchId: string;
  readonly reason: string;
  readonly permission: string;
  readonly actorId: string;
  readonly approvalId: string;
  readonly confirmedAt: string;
}

function selectCandidates(
  candidates: readonly BulkCandidate[],
  selection: BulkSelection,
): BulkCandidate[] {
  if (selection.type === 'selected') {
    const ids = new Set(selection.subscriberServiceIds);
    return candidates.filter((candidate) => ids.has(candidate.subscriberServiceId));
  }
  return candidates.filter((candidate) =>
    selection.type === 'area'
      ? candidate.areaId === selection.areaId
      : candidate.packageId === selection.packageId,
  );
}

function digest(input: unknown): string {
  const text = JSON.stringify(input);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function freezeCandidates(
  candidates: readonly BulkCandidate[],
): readonly Readonly<BulkCandidate>[] {
  return Object.freeze(candidates.map((candidate) => Object.freeze({ ...candidate })));
}

export function previewBulkImpact(input: {
  tenantId: TenantId;
  candidates: readonly BulkCandidate[];
  selection: BulkSelection;
  actionKind: NetworkAction['kind'];
  generatedAt: Date;
}): BulkImpactPreview {
  const selected = selectCandidates(input.candidates, input.selection);
  const included = selected.filter((candidate) => candidate.currentActionAllowed);
  const excluded = selected.filter((candidate) => !candidate.currentActionAllowed);
  const basis = {
    tenantId: input.tenantId,
    selection: input.selection,
    actionKind: input.actionKind,
    included: included.map((candidate) => candidate.subscriberServiceId).sort(),
    excluded: excluded
      .map((candidate) => [candidate.subscriberServiceId, candidate.exclusionReason])
      .sort(),
  };
  return Object.freeze({
    ...basis,
    included: freezeCandidates(included),
    excluded: freezeCandidates(excluded),
    generatedAt: input.generatedAt.toISOString(),
    digest: digest(basis),
  });
}

export function confirmBulkBatch(input: {
  preview: BulkImpactPreview;
  batchId: string;
  reason: string;
  permission: string;
  actorId: string;
  approvalId: string;
  confirmedAt: Date;
}): ImmutableBulkBatch {
  if (input.reason.trim().length < 8)
    throw new Error('Bulk network action requires a specific reason.');
  if (input.approvalId.trim().length === 0)
    throw new Error('Bulk network action requires approval.');
  return Object.freeze({
    ...input.preview,
    batchId: input.batchId,
    reason: input.reason,
    permission: input.permission,
    actorId: input.actorId,
    approvalId: input.approvalId,
    confirmedAt: input.confirmedAt.toISOString(),
  });
}
