import { registerPlatformPingAction } from './platformPing';

function mockRegistry() {
  const registered: any[] = [];
  return {
    registered,
    register: jest.fn((options: any) => {
      registered.push(options);
    }),
  };
}

describe('platform-ping action', () => {
  it('registers under name platform-ping with read-only attributes', () => {
    const registry = mockRegistry();
    registerPlatformPingAction({ actionsRegistry: registry as any });

    expect(registry.register).toHaveBeenCalledTimes(1);
    const r = registry.registered[0];
    expect(r.name).toBe('platform-ping');
    expect(r.attributes).toEqual({
      destructive: false,
      readOnly: true,
      idempotent: true,
    });
  });

  it('returns the module name and a parsable ISO timestamp', async () => {
    const registry = mockRegistry();
    registerPlatformPingAction({ actionsRegistry: registry as any });
    const result = await registry.registered[0].action({});
    expect(result.output.module).toBe('@internal/plugin-skylab-actions');
    expect(() => new Date(result.output.timestamp).toISOString()).not.toThrow();
  });
});
