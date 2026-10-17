import { LoggerService } from '@backstage/backend-plugin-api';
import { ActionsRegistryService } from '@backstage/backend-plugin-api/alpha';
import { ArgoServiceApi } from '@roadiehq/backstage-plugin-argo-cd-node';

type Failure = {
  instance: string;
  app: string;
  phase: string;
  finishedAt: string;
  message: string;
  syncStatus: string;
  healthStatus: string;
  revision: string;
};

const FAILED_PHASES = new Set(['Failed', 'Error']);

function extractFailure(
  app: any,
  instanceName: string,
  cutoff: number,
): Failure | undefined {
  const op = app?.status?.operationState;
  const phase: string | undefined = op?.phase;
  const finishedAt: string | undefined = op?.finishedAt;
  if (!phase || !FAILED_PHASES.has(phase) || !finishedAt) return undefined;

  const finishedMs = Date.parse(finishedAt);
  if (!Number.isFinite(finishedMs) || finishedMs < cutoff) return undefined;

  return {
    instance: instanceName,
    app: app?.metadata?.name ?? '<unknown>',
    phase,
    finishedAt,
    message: op?.message ?? '',
    syncStatus: app?.status?.sync?.status ?? 'Unknown',
    healthStatus: app?.status?.health?.status ?? 'Unknown',
    revision: op?.syncResult?.revision ?? op?.operation?.sync?.revision ?? '',
  };
}

export function registerArgocdRecentFailuresAction(options: {
  actionsRegistry: ActionsRegistryService;
  argocdService: ArgoServiceApi;
  logger: LoggerService;
}) {
  const { actionsRegistry, argocdService, logger } = options;

  actionsRegistry.register({
    name: 'argocd-recent-failures',
    title: 'List recent Argo CD sync failures',
    description: `
Lists Argo CD Applications whose most recent sync operation finished in a
failed state within a look-back window, across one or all configured Argo
CD instances. Read-only; no cluster or Argo state is changed.

## When to use

Use this to answer "what has gone wrong in Argo recently?" without having
to open the UI. Typical callers: an AI client triaging an alert, a chat
command summarizing deploy health, a dashboard tile.

## Inputs

- \`instance\` (optional): restrict to one configured Argo CD instance by
  name. Omit to query all instances.
- \`withinHours\` (optional, 1-168, default 24): only report failures whose
  \`finishedAt\` falls inside this window.
- \`limit\` (optional, 1-100, default 20): cap the number of failures
  returned, newest first.

## Output

Each failure includes the instance, app, operation phase + message, sync
+ health status, the revision Argo tried to sync, and the ISO timestamp
Argo recorded for the operation finishing.
    `,
    attributes: {
      destructive: false,
      readOnly: true,
      idempotent: true,
    },
    schema: {
      input: z =>
        z.object({
          instance: z
            .string()
            .optional()
            .describe(
              'Name of a single Argo CD instance to query; omit to query all configured instances.',
            ),
          withinHours: z
            .number()
            .int()
            .min(1)
            .max(168)
            .optional()
            .describe(
              'Only include failures whose finishedAt is within this many hours. Default 24.',
            ),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe('Maximum failures returned, newest first. Default 20.'),
        }),
      output: z =>
        z.object({
          failures: z
            .array(
              z.object({
                instance: z.string(),
                app: z.string(),
                phase: z.string(),
                finishedAt: z.string(),
                message: z.string(),
                syncStatus: z.string(),
                healthStatus: z.string(),
                revision: z.string(),
              }),
            )
            .describe('Failed sync operations, sorted newest first.'),
          totalAppsChecked: z
            .number()
            .describe(
              'Total Applications inspected across all queried instances.',
            ),
          instancesChecked: z
            .array(z.string())
            .describe('Names of the Argo CD instances this call reached.'),
          warnings: z
            .array(z.string())
            .describe(
              'Instance names whose query failed, with the error message.',
            ),
        }),
    },
    action: async ({ input }) => {
      const withinHours = input.withinHours ?? 24;
      const limit = input.limit ?? 20;
      const cutoff = Date.now() - withinHours * 60 * 60 * 1000;

      const configured = argocdService.getArgoInstanceArray();
      const instances = input.instance
        ? configured.filter(i => i.name === input.instance)
        : configured;

      if (input.instance && instances.length === 0) {
        throw new Error(
          `No Argo CD instance named '${input.instance}' is configured.`,
        );
      }

      const failures: Failure[] = [];
      const warnings: string[] = [];
      const instancesChecked: string[] = [];
      let totalAppsChecked = 0;

      for (const instance of instances) {
        try {
          const token = await argocdService.getArgoToken(instance);
          const data = await argocdService.getArgoAppData(
            instance.url,
            instance.name,
            token,
          );
          const items = data.items ?? [];
          totalAppsChecked += items.length;
          for (const app of items) {
            const f = extractFailure(app, instance.name, cutoff);
            if (f) failures.push(f);
          }
          instancesChecked.push(instance.name);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn(
            `argocd-recent-failures: instance=${instance.name} failed: ${msg}`,
          );
          warnings.push(`${instance.name}: ${msg}`);
        }
      }

      failures.sort(
        (a, b) => Date.parse(b.finishedAt) - Date.parse(a.finishedAt),
      );

      return {
        output: {
          failures: failures.slice(0, limit),
          totalAppsChecked,
          instancesChecked,
          warnings,
        },
      };
    },
  });
}
