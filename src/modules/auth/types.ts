export type { AuthProvider } from "@/modules/shared/config/providers";

export type AccountInfo = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string | null;
};
