export type ID = string | number;

export type RecordValue = string | number | boolean | null | undefined;

export type FlexibleValue = RecordValue | RecordValue[] | FlexibleRecord | FlexibleRecord[];

export interface FlexibleRecord {
  [key: string]: FlexibleValue;
}

export interface User {
  id?: ID;
  username?: string;
  name?: string;
  display_name?: string;
  is_active?: boolean;
  is_locked?: boolean;
  locked_until?: string | null;
  last_login_at?: string | null;
  email?: string;
  role?: string;
  permissions?: string[];
  plantId?: ID;
  plantIds?: ID[];
  token?: string;
  metadata?: FlexibleRecord;
}

export interface AuthState {
  user: User | null;
  isAuthenticated?: boolean;
  isLoading?: boolean;
  error?: string | null;
}

export interface Plant {
  id?: ID;
  cc?: string;
  name: string;
  displayName?: string;
  location?: string;
  region?: string;
  status?: string;
  isActive?: boolean;
  metadata?: FlexibleRecord;
}

export interface KpiData {
  id?: ID;
  key?: string;
  label: string;
  value: string | number;
  unit?: string;
  trend?: string | number;
  accent?: string;
  status?: string;
  description?: string;
  metadata?: FlexibleRecord;
}

export interface SidebarItem {
  key: string;
  label: string;
  path?: string;
  iconKey?: string;
  disabled?: boolean;
  children?: SidebarItem[];
  metadata?: FlexibleRecord;
}

export interface SidebarSection {
  group: string;
  items: SidebarItem[];
  key?: string;
  collapsed?: boolean;
  metadata?: FlexibleRecord;
}

export interface ApiResponse<T = unknown> {
  data?: T;
  message?: string;
  error?: string | null;
  success?: boolean;
  status?: number;
  metadata?: FlexibleRecord;
}
