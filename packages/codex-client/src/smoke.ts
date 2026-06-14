import { CodexAppServerClient } from "./index.js";

const client = new CodexAppServerClient({ requestTimeoutMs: 15_000 });

try {
  await client.start();
  const response = (await client.request("account/read", {
    refreshToken: false,
  })) as {
    account?: { type?: string; planType?: string | null } | null;
    requiresOpenaiAuth?: boolean;
  };
  console.log(
    JSON.stringify(
      {
        ok: true,
        version: client.version,
        auth: {
          type: response.account?.type ?? null,
          planType: response.account?.planType ?? null,
          required: response.requiresOpenaiAuth ?? null,
        },
      },
      null,
      2,
    ),
  );
} finally {
  await client.stop();
}
