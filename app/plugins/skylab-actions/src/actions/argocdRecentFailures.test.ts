import { registerArgocdRecentFailuresAction } from './argocdRecentFailures';

function mockRegistry() {
  const registered: any[] = [];
  return {
    registered,
    register: jest.fn((options: any) => {
      registered.push(options);
    }),
  };
}

function mockLogger(): any {
  const logger: any = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
  logger.child = jest.fn(() => logger);
  return logger;
}

function app(opts: {
  name: string;
  phase?: string;
  finishedAt?: string;
  message?: string;
  syncStatus?: string;
  healthStatus?: string;
  revision?: string;
}) {
  return {
    metadata: { name: opts.name },
    status: {
      sync: { status: opts.syncStatus ?? 'Synced' },
      health: { status: opts.healthStatus ?? 'Healthy' },
      operationState:
        opts.phase === undefined && opts.finishedAt === undefined
          ? undefined
          : {
              phase: opts.phase,
              finishedAt: opts.finishedAt,
              message: opts.message,
              syncResult: opts.revision
                ? { revision: opts.revision }
                : undefined,
            },
    },
  };
}

function invoke(registered: any[], input: any) {
  return registered[0].action({ input });
}

describe('argocd-recent-failures action', () => {
  const NOW = Date.parse('2026-10-17T12:00:00Z');
  const RECENT = new Date(NOW - 60 * 60 * 1000).toISOString(); // 1h ago
  const OLD = new Date(NOW - 48 * 60 * 60 * 1000).toISOString(); // 48h ago

  beforeEach(() => {
    jest.spyOn(Date, 'now').mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('registers under the right name with read-only attributes', () => {
    const registry = mockRegistry();
    const argocdService: any = {
      getArgoInstanceArray: () => [],
    };
    registerArgocdRecentFailuresAction({
      actionsRegistry: registry as any,
      argocdService,
      logger: mockLogger() as any,
    });

    expect(registry.register).toHaveBeenCalledTimes(1);
    const r = registry.registered[0];
    expect(r.name).toBe('argocd-recent-failures');
    expect(r.attributes).toEqual({
      destructive: false,
      readOnly: true,
      idempotent: true,
    });
  });

  it('filters to failed phases inside the window, newest first', async () => {
    const registry = mockRegistry();
    const argocdService: any = {
      getArgoInstanceArray: () => [
        { name: 'homelab', url: 'https://argo.example.com' },
      ],
      getArgoToken: jest.fn(async () => 'token'),
      getArgoAppData: jest.fn(async () => ({
        items: [
          app({ name: 'healthy-app' }),
          app({
            name: 'old-failure',
            phase: 'Failed',
            finishedAt: OLD,
            message: 'stale',
          }),
          app({
            name: 'recent-failure',
            phase: 'Failed',
            finishedAt: RECENT,
            message: 'boom',
            syncStatus: 'OutOfSync',
            healthStatus: 'Degraded',
            revision: 'abc123',
          }),
          app({
            name: 'recent-error',
            phase: 'Error',
            finishedAt: new Date(NOW - 30 * 60 * 1000).toISOString(),
            message: 'kaboom',
          }),
          app({
            name: 'running',
            phase: 'Running',
            finishedAt: RECENT,
            message: 'still going',
          }),
        ],
      })),
    };
    registerArgocdRecentFailuresAction({
      actionsRegistry: registry as any,
      argocdService,
      logger: mockLogger() as any,
    });

    const { output } = await invoke(registry.registered, {});

    expect(output.failures.map((f: any) => f.app)).toEqual([
      'recent-error',
      'recent-failure',
    ]);
    expect(output.failures[1]).toMatchObject({
      instance: 'homelab',
      app: 'recent-failure',
      phase: 'Failed',
      message: 'boom',
      syncStatus: 'OutOfSync',
      healthStatus: 'Degraded',
      revision: 'abc123',
    });
    expect(output.totalAppsChecked).toBe(5);
    expect(output.instancesChecked).toEqual(['homelab']);
    expect(output.warnings).toEqual([]);
  });

  it('honours withinHours + limit', async () => {
    const registry = mockRegistry();
    const argocdService: any = {
      getArgoInstanceArray: () => [
        { name: 'homelab', url: 'https://argo.example.com' },
      ],
      getArgoToken: jest.fn(async () => 'token'),
      getArgoAppData: jest.fn(async () => ({
        items: [
          app({
            name: 'a',
            phase: 'Failed',
            finishedAt: new Date(NOW - 10 * 60 * 1000).toISOString(),
          }),
          app({
            name: 'b',
            phase: 'Failed',
            finishedAt: new Date(NOW - 20 * 60 * 1000).toISOString(),
          }),
          app({
            name: 'c',
            phase: 'Failed',
            finishedAt: new Date(NOW - 3 * 60 * 60 * 1000).toISOString(),
          }),
        ],
      })),
    };
    registerArgocdRecentFailuresAction({
      actionsRegistry: registry as any,
      argocdService,
      logger: mockLogger() as any,
    });

    const { output } = await invoke(registry.registered, {
      withinHours: 1,
      limit: 1,
    });

    expect(output.failures).toHaveLength(1);
    expect(output.failures[0].app).toBe('a');
  });

  it('records a warning but keeps going when one instance fails', async () => {
    const registry = mockRegistry();
    const argocdService: any = {
      getArgoInstanceArray: () => [
        { name: 'homelab', url: 'https://argo1.example.com' },
        { name: 'prod', url: 'https://argo2.example.com' },
      ],
      getArgoToken: jest.fn(async (i: any) => {
        if (i.name === 'homelab') throw new Error('login refused');
        return 'token';
      }),
      getArgoAppData: jest.fn(async () => ({
        items: [
          app({
            name: 'prod-fail',
            phase: 'Failed',
            finishedAt: RECENT,
            message: 'kaboom',
          }),
        ],
      })),
    };
    registerArgocdRecentFailuresAction({
      actionsRegistry: registry as any,
      argocdService,
      logger: mockLogger() as any,
    });

    const { output } = await invoke(registry.registered, {});

    expect(output.failures.map((f: any) => f.app)).toEqual(['prod-fail']);
    expect(output.instancesChecked).toEqual(['prod']);
    expect(output.warnings).toEqual(['homelab: login refused']);
  });

  it('errors cleanly when the named instance is not configured', async () => {
    const registry = mockRegistry();
    const argocdService: any = {
      getArgoInstanceArray: () => [
        { name: 'homelab', url: 'https://argo.example.com' },
      ],
      getArgoToken: jest.fn(),
      getArgoAppData: jest.fn(),
    };
    registerArgocdRecentFailuresAction({
      actionsRegistry: registry as any,
      argocdService,
      logger: mockLogger() as any,
    });

    await expect(
      invoke(registry.registered, { instance: 'nope' }),
    ).rejects.toThrow(/No Argo CD instance named 'nope'/);
    expect(argocdService.getArgoToken).not.toHaveBeenCalled();
  });
});
