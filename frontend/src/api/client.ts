import { axiosInstance } from '@/api/axios.ts';

const ADMIN_BASE = '/api/admin/extensions/dev.caloptreyx.eggchanger';

export interface EggItem {
  uuid: string;
  name: string;
  nest_uuid: string;
  nest_name: string;
}

export interface EggRule {
  id: string;
  eggs: string[];
  allowed_eggs: string[];
}

export interface AdminSettingsResponse {
  apply_allocation_deployment: boolean;
  egg_rules: EggRule[];
  eggs: EggItem[];
}

export interface EggRulePayload {
  eggs: string[];
  allowed_eggs: string[];
}

export interface NamedValue {
  name: string;
  value: string;
}

export interface TargetEgg {
  uuid: string;
  name: string;
  description: string | null;
  nest_uuid: string;
  nest_name: string;
  startup_commands: NamedValue[];
  docker_images: NamedValue[];
  allow_custom_startup_command: boolean;
  deployment_allocations: number;
}

export interface EggChangerIndex {
  current_egg: { uuid: string; name: string };
  eggs: TargetEgg[];
}

export interface ChangeEggPayload {
  egg_uuid: string;
  startup: string;
  image: string;
  reinstall: boolean;
  truncate_directory: boolean;
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

export async function updateAdminSettings(payload: { apply_allocation_deployment: boolean }): Promise<void> {
  await axiosInstance.put(`${ADMIN_BASE}/settings`, payload);
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

export async function getEggChangerIndex(serverUuid: string): Promise<EggChangerIndex> {
  const { data } = await axiosInstance.get(`/api/client/servers/${serverUuid}/egg-changer`);
  return data;
}

export async function changeEgg(serverUuid: string, payload: ChangeEggPayload): Promise<ChangeEggResponse> {
  const { data } = await axiosInstance.post(`/api/client/servers/${serverUuid}/egg-changer`, payload);
  return data;
}
