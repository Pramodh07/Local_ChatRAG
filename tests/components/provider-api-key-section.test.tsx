// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ProviderApiKeySection } from "@/modules/account/components/provider-api-key-section";

const account = { id: "account-1" };
const preferences = { provider: "openai" as const, model: "gpt-6.2-sol", theme: "light" as const };

describe("ProviderApiKeySection (server keys only)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("does not render a browser-stored API key field", () => {
    render(<ProviderApiKeySection account={account} preferences={preferences} localMode />);

    expect(screen.queryByLabelText("API key")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Paste provider API key")).not.toBeInTheDocument();
    expect(screen.getByText(/Keys are read from server environment variables/)).toBeInTheDocument();
  });

  it("tests the selected provider through the server without a key header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connected: true }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProviderApiKeySection account={account} preferences={preferences} localMode />);
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => expect(screen.getByText("Connection successful.")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account/models/test",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ provider: "openai" }),
      }),
    );
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("x-atlas-provider-key");
  });

  it("shows the server error message when the connection fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({ error: "Provider is not configured on the server." }),
      }),
    );

    render(<ProviderApiKeySection account={account} preferences={preferences} localMode />);
    await userEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() =>
      expect(screen.getByText("Provider is not configured on the server.")).toBeInTheDocument(),
    );
  });
});
