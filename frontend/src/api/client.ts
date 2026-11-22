import { z } from 'zod';
import { axiosInstance } from '@/api/axios.ts';
import type { Placement } from '../lib/placement.ts';

const ADMIN_BASE = '/api/admin/extensions/dev.caloptreyx.eggchanger';

export interface EggItem {
  uuid: string;
  name: string;
  nest_uuid: string;
  nest_name: string;
}

export interface EggRuleOptions {
  force_startup_update: boolean;
  force_reinstall: boolean;
  force_truncate: boolean;
  reassign_allocations: boolean;
  force_backup: boolean;
}

export interface EggRule {
  id: string;
  eggs: string[];
  allowed_eggs: string[];
  options: EggRuleOptions;
}

/** Optional pictures of an egg: https URLs, rendered only as `<img src>`. */
export interface EggAppearance {
  /** Square icon. */
  icon: string | null;
  /** Wide banner, shown at 3:1. */
  banner: string | null;
}

export interface AdminSettingsResponse {
  egg_rules: EggRule[];
  placement: Placement;
  /** By egg UUID; eggs without pictures are missing. */
  egg_appearance: Record<string, EggAppearance>;
  eggs: EggItem[];
}

export type EggRulePayload = Omit<EggRule, 'id'>;

export interface NamedValue {
  name: string;
  value: string;
}

export interface TargetEgg extends EggAppearance {
  uuid: string;
  name: string;
  description: string | null;
  nest_uuid: string;
  nest_name: string;
  startup_commands: NamedValue[];
  docker_images: NamedValue[];
  allow_custom_startup_command: boolean;
  deployment_allocations: number;
  options: EggRuleOptions;
}

export interface CurrentEgg extends EggAppearance {
  uuid: string;
  name: string;
  description: string | null;
  nest_name: string;
}

export interface EggChangerIndex {
  current_egg: CurrentEgg;
  eggs: TargetEgg[];
  /** Why the user can't create a backup before switching, or null when they can. */
  backup_unavailable: string | null;
}

export interface ChangeEggPayload {
  egg_uuid: string;
  startup: string | null;
  image: string;
  keep_startup: boolean;
  reinstall: boolean;
  truncate_directory: boolean;
  /** A backup made right before switching; it must have finished successfully. */
  backup_uuid: string | null;
}

export interface ChangeEggResponse {
  egg: { uuid: string; name: string };
  reinstalling: boolean;
  allocations: { ip: string; port: number }[];
}

export async function getAdminSettings(): Promise<AdminSettingsResponse> {
  const { data } = await axiosInstance.get(`${ADMIN_BASE}/settings`);
  return data;
}

export async function updatePlacement(placement: Placement): Promise<void> {
  await axiosInstance.put(`${ADMIN_BASE}/settings`, { placement });
}

export async function createEggRule(payload: EggRulePayload): Promise<EggRule> {
  const { data } = await axiosInstance.post(`${ADMIN_BASE}/egg-rules`, payload);
  return data;
}

export async function updateEggRule(id: string, payload: EggRulePayload): Promise<void> {
  await axiosInstance.put(`${ADMIN_BASE}/egg-rules/${id}`, payload);
}

export async function deleteEggRule(id: string): Promise<void> {
  await axiosInstance.delete(`${ADMIN_BASE}/egg-rules/${id}`);
}

export async function updateEggAppearance(eggUuid: string, payload: EggAppearance): Promise<EggAppearance> {
  const { data } = await axiosInstance.put(`${ADMIN_BASE}/egg-appearance/${eggUuid}`, payload);
  return data;
}

const uploadResponseSchema = z.object({ assets: z.array(z.object({ url: z.string() })).min(1) });

/**
 * Uploads an image to the panel's own asset storage (Admin → Assets, folder `egg-changer`) and
 * returns its public URL. Needs the core `assets.upload` permission.
 */
export async function uploadImageAsset(file: File, name: string): Promise<string> {
  const form = new FormData();
  form.append('files', file, name);
  const { data } = await axiosInstance.putForm('/api/admin/assets', form, { params: { directory: 'egg-changer' } });
  return uploadResponseSchema.parse(data).assets[0].url;
}

export async function getEggChangerIndex(serverUuid: string): Promise<EggChangerIndex> {
  const { data } = await axiosInstance.get(`/api/client/servers/${serverUuid}/egg-changer`);
  return data;
}

export async function changeEgg(serverUuid: string, payload: ChangeEggPayload): Promise<ChangeEggResponse> {
  const { data } = await axiosInstance.post(`/api/client/servers/${serverUuid}/egg-changer`, payload);
  return data;
}
