import { ScmIntegrations } from '@backstage/integration';
import { ConfigReader } from '@backstage/config';
import { PassThrough } from 'stream';
import { createGiteaPullRequestAction } from './createGiteaPullRequest';

jest.mock('@backstage/plugin-scaffolder-node', () => {
  const actual = jest.requireActual('@backstage/plugin-scaffolder-node');
  return {
    ...actual,
    cloneRepo: jest.fn().mockResolvedValue(undefined),
    createBranch: jest.fn().mockResolvedValue(undefined),
    addFiles: jest.fn().mockResolvedValue(undefined),
    commitAndPushBranch: jest.fn().mockResolvedValue(undefined),
  };
});

jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdtemp: jest.fn().mockResolvedValue('/tmp/gitea-pr-xxx'),
      readdir: jest.fn().mockResolvedValue([]),
      rm: jest.fn().mockResolvedValue(undefined),
    },
  };
});

const integrations = ScmIntegrations.fromConfig(
  new ConfigReader({
    integrations: {
      gitea: [
        {
          host: 'gitea.example.com',
          username: 'backstage-bot',
          password: 'test-token',
        },
      ],
    },
  }),
);

const expectedBasicAuth = `Basic ${Buffer.from('backstage-bot:test-token').toString('base64')}`;

function makeContext(input: Record<string, unknown>) {
  const outputs: Record<string, unknown> = {};
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: () => logger,
  };
  return {
    input,
    workspacePath: '/tmp/does-not-matter',
    logger,
    logStream: new PassThrough(),
    output: (key: string, value: unknown) => {
      outputs[key] = value;
    },
    createTemporaryDirectory: jest
      .fn()
      .mockResolvedValue('/tmp/does-not-matter'),
    getInitiatorCredentials: jest.fn(),
    checkpoint: jest.fn(),
    outputs,
  } as any;
}

describe('createGiteaPullRequestAction', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = originalFetch;
  });

  it('posts to the Gitea PR endpoint and emits output', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        number: 42,
        html_url: 'https://gitea.example.com/platform/tenants/pulls/42',
      }),
    });
    (global as any).fetch = fetchMock;

    const action = createGiteaPullRequestAction({ integrations });
    const ctx = makeContext({
      repoUrl: 'gitea.example.com?owner=platform&repo=tenants',
      branchName: 'add-service-foo',
      title: 'Add service foo',
      description: 'Scaffolded by Backstage',
    });

    await (action as any).handler(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://gitea.example.com/api/v1/repos/platform/tenants/pulls',
    );
    expect(init.headers.Authorization).toBe(expectedBasicAuth);
    const body = JSON.parse(init.body);
    expect(body).toEqual({
      title: 'Add service foo',
      body: 'Scaffolded by Backstage',
      head: 'add-service-foo',
      base: 'main',
    });
    expect(ctx.outputs.pullRequestUrl).toBe(
      'https://gitea.example.com/platform/tenants/pulls/42',
    );
    expect(ctx.outputs.pullRequestNumber).toBe(42);
    expect(ctx.outputs.merged).toBe(false);
  });

  it('merges the PR when automerge is true', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 7,
          html_url: 'https://gitea.example.com/platform/tenants/pulls/7',
        }),
      })
      .mockResolvedValueOnce({ ok: true, text: async () => '' });
    (global as any).fetch = fetchMock;

    const action = createGiteaPullRequestAction({ integrations });
    const ctx = makeContext({
      repoUrl: 'gitea.example.com?owner=platform&repo=tenants',
      branchName: 'add-db-foo',
      title: 'Add db',
      description: 'auto',
      automerge: true,
    });

    await (action as any).handler(ctx);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [mergeUrl, mergeInit] = fetchMock.mock.calls[1];
    expect(mergeUrl).toBe(
      'https://gitea.example.com/api/v1/repos/platform/tenants/pulls/7/merge',
    );
    expect(mergeInit.headers.Authorization).toBe(expectedBasicAuth);
    expect(JSON.parse(mergeInit.body)).toEqual({
      Do: 'squash',
      delete_branch_after_merge: true,
    });
    expect(ctx.outputs.merged).toBe(true);
  });

  it('retries the merge call on 405 and gives up after a few attempts', async () => {
    const notReady = {
      ok: false,
      status: 405,
      statusText: 'Method Not Allowed',
      text: async () => 'Please check your pull request status',
    };
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          number: 9,
          html_url: 'https://gitea.example.com/platform/tenants/pulls/9',
        }),
      })
      .mockResolvedValue(notReady);
    (global as any).fetch = fetchMock;

    const action = createGiteaPullRequestAction({ integrations });
    const ctx = makeContext({
      repoUrl: 'gitea.example.com?owner=platform&repo=tenants',
      branchName: 'b',
      title: 't',
      description: 'd',
      automerge: true,
    });

    await expect((action as any).handler(ctx)).rejects.toThrow(
      /Gitea merge API returned 405/,
    );
    // 1 create + 5 merge attempts
    expect(fetchMock).toHaveBeenCalledTimes(6);
  }, 10000);

  it('throws if the host is not configured', async () => {
    const action = createGiteaPullRequestAction({ integrations });
    const ctx = makeContext({
      repoUrl: 'gitea.other.com?owner=platform&repo=tenants',
      branchName: 'b',
      title: 't',
      description: 'd',
    });
    await expect((action as any).handler(ctx)).rejects.toThrow(
      /No Gitea integration configured for host gitea.other.com/,
    );
  });

  it('throws when Gitea API returns non-ok', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => 'branch already has an open PR',
    });

    const action = createGiteaPullRequestAction({ integrations });
    const ctx = makeContext({
      repoUrl: 'gitea.example.com?owner=platform&repo=tenants',
      branchName: 'b',
      title: 't',
      description: 'd',
    });

    await expect((action as any).handler(ctx)).rejects.toThrow(
      /Gitea API returned 422/,
    );
  });
});
