import type {
  AccountPreferences,
  ModelOption,
  ProviderModels,
  UsageBucket,
} from "@/modules/account/types";
import { isModelProvider } from "@/modules/account/types";
import { isRecord } from "@/modules/shared/lib/guards";
import { isTheme } from "@/modules/shared/lib/theme";

export function parsePreferences(value: unknown): AccountPreferences | null {
  if (
    !isRecord(value) ||
    !isModelProvider(value.provider) ||
    typeof value.model !== "string" ||
    !isTheme(value.theme)
  ) {
    return null;
  }
  return { provider: value.provider, model: value.model, theme: value.theme };
}

export function parseUsageBuckets(value: unknown): UsageBucket[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: UsageBucket[] = [];
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.date !== "string" ||
      !isModelProvider(item.provider) ||
      typeof item.model !== "string" ||
      typeof item.requests !== "number" ||
      typeof item.inputTokens !== "number" ||
      typeof item.outputTokens !== "number" ||
      typeof item.estimatedCostUsd !== "number" ||
      typeof item.costEstimateComplete !== "boolean"
    ) {
      return null;
    }
    parsed.push({
      date: item.date,
      provider: item.provider,
      model: item.model,
      requests: item.requests,
      inputTokens: item.inputTokens,
      outputTokens: item.outputTokens,
      estimatedCostUsd: item.estimatedCostUsd,
      costEstimateComplete: item.costEstimateComplete,
    });
  }
  return parsed;
}

function isModelOption(value: unknown): value is ModelOption {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.inputUsdPerMillion === null || typeof value.inputUsdPerMillion === "number") &&
    (value.outputUsdPerMillion === null || typeof value.outputUsdPerMillion === "number")
  );
}

export function parseProviders(value: unknown): ProviderModels[] | null {
  if (!Array.isArray(value)) return null;

  const parsed: ProviderModels[] = [];
  for (const provider of value) {
    if (
      !isRecord(provider) ||
      !isModelProvider(provider.id) ||
      typeof provider.name !== "string" ||
      typeof provider.configured !== "boolean" ||
      !Array.isArray(provider.models)
    ) {
      return null;
    }
    const models = provider.models.filter(isModelOption);
    if (models.length !== provider.models.length) return null;

    parsed.push({
      id: provider.id,
      name: provider.name,
      configured: provider.configured,
      models,
      ...(typeof provider.message === "string" && { message: provider.message }),
    });
  }
  return parsed;
}

const costFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 6,
});
const tokenFormatter = new Intl.NumberFormat("en-US");

export function formatCost(value: number): string {
  return costFormatter.format(value);
}

export function formatTokens(value: number): string {
  return tokenFormatter.format(value);
}

export function processAvatarFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read image file."));
    reader.onload = () => {
      if (file.type === "image/gif") {
        resolve(reader.result as string);
        return;
      }

      const image = new Image();
      image.onerror = () => reject(new Error("Failed to load image."));
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const targetSize = 256;
          canvas.width = targetSize;
          canvas.height = targetSize;
          const context = canvas.getContext("2d");
          if (!context) {
            resolve(reader.result as string);
            return;
          }
          const minSide = Math.min(image.width, image.height);
          const offsetX = (image.width - minSide) / 2;
          const offsetY = (image.height - minSide) / 2;
          context.drawImage(image, offsetX, offsetY, minSide, minSide, 0, 0, targetSize, targetSize);
          resolve(canvas.toDataURL("image/jpeg", 0.9));
        } catch {
          resolve(reader.result as string);
        }
      };
      image.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}
