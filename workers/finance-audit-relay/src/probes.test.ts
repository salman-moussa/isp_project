import { describe, expect, it, vi } from 'vitest';
import { probeControlRelayCapability, probeTenantRelayCapability } from './probes.js';

type ProbeClient = Parameters<typeof probeControlRelayCapability>[0];

function clientReturning(row: Readonly<Record<string, boolean>>): ProbeClient {
  return {
    unsafe: vi.fn().mockResolvedValue([row]),
  } as unknown as ProbeClient;
}

const baseCapabilities = {
  relation_exists: true,
  required_columns_exist: true,
  schema_usage: true,
  can_select: true,
  can_insert: true,
  marker_exists: true,
  can_execute_marker: true,
  discovery_exists: true,
  can_execute_discovery: true,
  operations_ready: true,
  subscription_state_ready: true,
};

describe('finance audit relay database capability probes', () => {
  it('requires the control-plane request correlation column', async () => {
    const unsafe = vi.fn().mockResolvedValue([baseCapabilities]);
    const client = { unsafe } as unknown as ProbeClient;

    await expect(probeControlRelayCapability(client)).resolves.toBeUndefined();
    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining('count(*) = 8'));
    expect(unsafe).toHaveBeenCalledWith(expect.stringContaining("'request_reference'"));
  });

  it('fails the control probe when schema exists but INSERT is unavailable', async () => {
    const client = clientReturning({ ...baseCapabilities, can_insert: false });
    await expect(probeControlRelayCapability(client)).rejects.toThrow(/capability/u);
  });

  it('fails the tenant probe without marker execution and accepts the full relay grant', async () => {
    const denied = clientReturning({ ...baseCapabilities, can_execute_marker: false });
    await expect(probeTenantRelayCapability(denied)).rejects.toThrow(/capability/u);

    const allowed = clientReturning(baseCapabilities);
    await expect(probeTenantRelayCapability(allowed)).resolves.toBeUndefined();
  });
});
