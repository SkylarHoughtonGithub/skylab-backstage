import { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';

export function registerPlatformPingAction(options: {
  actionsRegistry: ActionsRegistryService;
}) {
  const { actionsRegistry } = options;

  actionsRegistry.register({
    name: 'platform-ping',
    title: 'Ping the Skylab platform',
    description: `
A trivial liveness probe for Skylab's MCP action surface. Returns the
current UTC timestamp and the module's name so AI clients can confirm
they can reach the Backstage MCP endpoint before invoking the real
platform actions.

## When to use

Use this as a round-trip check when debugging MCP connectivity, or at
the start of a session to prove the actions registry is reachable.
    `,
    attributes: {
      destructive: false,
      readOnly: true,
      idempotent: true,
    },
    schema: {
      input: z => z.object({}),
      output: z =>
        z.object({
          module: z.string().describe('Name of the module serving the ping.'),
          timestamp: z
            .string()
            .describe('UTC ISO-8601 timestamp of when the server replied.'),
        }),
    },
    action: async () => ({
      output: {
        module: '@internal/plugin-skylab-actions',
        timestamp: new Date().toISOString(),
      },
    }),
  });
}
