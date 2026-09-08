import { z } from 'zod';

export const nasClientSchema = z.object({
  id: z.string().uuid(),
  nasName: z.string().trim().min(2).max(100),
  ipAddress: z.string().trim(),
  secretReference: z.string().trim(),
  nasType: z.enum(['mikrotik', 'cisco', 'huawei', 'other']),
  active: z.boolean(),
});
export type NasClientRecord = z.infer<typeof nasClientSchema>;

export const radiusSessionSchema = z.object({
  id: z.string().uuid(),
  acctSessionId: z.string().trim(),
  username: z.string().trim(),
  framedIpAddress: z.string().nullable(),
  callingStationId: z.string().nullable(),
  startedAt: z.string(),
  stoppedAt: z.string().nullable(),
  inputOctets: z.number().int().nonnegative(),
  outputOctets: z.number().int().nonnegative(),
  terminateCause: z.string().nullable(),
});
export type RadiusSessionRecord = z.infer<typeof radiusSessionSchema>;

export const ipPoolSchema = z.object({
  id: z.string().uuid(),
  poolName: z.string().trim().min(2).max(100),
  subnetCidr: z.string().trim(),
  ipVersion: z.enum(['v4', 'v6']),
  gateway: z.string().nullable(),
  vlanId: z.number().int().min(1).max(4094).nullable(),
  active: z.boolean(),
});
export type IpPoolRecord = z.infer<typeof ipPoolSchema>;

export const cpeDeviceSchema = z.object({
  id: z.string().uuid(),
  serialNumber: z.string().trim().min(2).max(100),
  oui: z.string().nullable(),
  tr069DeviceId: z.string().nullable(),
  firmwareVersion: z.string().nullable(),
  connectionRequestUrl: z.string().nullable(),
  lastInformAt: z.string().nullable(),
  status: z.enum(['online', 'offline']),
});
export type CpeDeviceRecord = z.infer<typeof cpeDeviceSchema>;
