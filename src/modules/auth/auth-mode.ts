export type {
  AuthMode,
  AuthProvider,
  DatabaseProvider,
  ProviderConfig,
  ProviderEnvironment,
} from "@/modules/shared/config/providers";

export {
  getAuthMode,
  getAuthProvider,
  getDatabaseProvider,
  getProviderConfig,
  isLocalAuthEnabled,
  resolveProviderConfig,
} from "@/modules/shared/config/providers";
