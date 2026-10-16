import { InputError } from '@backstage/errors';
import { ScmIntegrations } from '@backstage/integration';
import {
  addFiles,
  cloneRepo,
  commitAndPushBranch,
  createBranch,
  createTemplateAction,
} from '@backstage/plugin-scaffolder-node';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';

type Options = {
  integrations: ScmIntegrations;
};

type GiteaCreatePullRequestResponse = {
  number: number;
  html_url: string;
};

type ParsedRepo = {
  host: string;
  owner: string;
  repo: string;
};

function parseRepoUrl(repoUrl: string): ParsedRepo {
  const parsed = new URL(`https://${repoUrl}`);
  const host = parsed.host;
  const owner = parsed.searchParams.get('owner');
  const repo = parsed.searchParams.get('repo');
  if (!host || !owner || !repo) {
    throw new InputError(
      `Invalid repoUrl ${repoUrl}: expected host?owner=<owner>&repo=<repo>`,
    );
  }
  return { host, owner, repo };
}

async function copyWorkspace(src: string, dest: string): Promise<void> {
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git') continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await fs.mkdir(to, { recursive: true });
      await copyWorkspace(from, to);
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

export function createGiteaPullRequestAction(options: Options) {
  const { integrations } = options;

  return createTemplateAction({
    id: 'gitea:pull-request',
    description:
      'Clones a Gitea repo, commits the scaffolder workspace to a new branch, pushes, and opens a pull request.',
    schema: {
      input: {
        repoUrl: z =>
          z
            .string()
            .describe(
              'Gitea repo URL in the form host?owner=<owner>&repo=<repo>',
            ),
        branchName: z =>
          z.string().describe('New branch to create and push to'),
        title: z => z.string().describe('Pull request title'),
        description: z => z.string().describe('Pull request body'),
        targetBranchName: z =>
          z
            .string()
            .optional()
            .describe('Target branch for the PR (defaults to the HEAD branch)'),
        commitMessage: z =>
          z
            .string()
            .optional()
            .describe('Commit message (defaults to the PR title)'),
        gitAuthorName: z =>
          z.string().optional().describe('Commit author name'),
        gitAuthorEmail: z =>
          z.string().optional().describe('Commit author email'),
      },
      output: {
        pullRequestUrl: z => z.string().describe('HTML URL of the created PR'),
        pullRequestNumber: z =>
          z.number().describe('Pull request number in Gitea'),
      },
    },
    async handler(ctx) {
      const {
        repoUrl,
        branchName,
        title,
        description,
        targetBranchName,
        commitMessage,
        gitAuthorName,
        gitAuthorEmail,
      } = ctx.input;

      const { host, owner, repo } = parseRepoUrl(repoUrl);

      const integration = integrations.gitea.byHost(host);
      if (!integration) {
        throw new InputError(
          `No Gitea integration configured for host ${host}`,
        );
      }
      const { username, password } = integration.config;
      if (!username || !password) {
        throw new InputError(
          `Gitea integration for ${host} is missing username/password; set a Gitea PAT as the password`,
        );
      }

      const auth = { username, password };
      const cloneDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gitea-pr-'));

      try {
        await cloneRepo({
          url: `https://${host}/${owner}/${repo}.git`,
          dir: cloneDir,
          auth,
          ref: targetBranchName,
          logger: ctx.logger,
        });

        await createBranch({
          dir: cloneDir,
          ref: branchName,
          auth,
          logger: ctx.logger,
        });

        await copyWorkspace(ctx.workspacePath, cloneDir);

        await addFiles({
          dir: cloneDir,
          filepath: '.',
          auth,
          logger: ctx.logger,
        });

        await commitAndPushBranch({
          dir: cloneDir,
          auth,
          commitMessage: commitMessage ?? title,
          gitAuthorInfo: {
            name: gitAuthorName ?? 'skylab-backstage',
            email: gitAuthorEmail ?? 'backstage@skylab.local',
          },
          branch: branchName,
          logger: ctx.logger,
        });

        const basicAuth = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
        const response = await fetch(
          `https://${host}/api/v1/repos/${owner}/${repo}/pulls`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: basicAuth,
            },
            body: JSON.stringify({
              title,
              body: description,
              head: branchName,
              base: targetBranchName ?? 'main',
            }),
          },
        );

        if (!response.ok) {
          const body = await response.text();
          throw new Error(
            `Gitea API returned ${response.status} ${response.statusText}: ${body}`,
          );
        }

        const pr = (await response.json()) as GiteaCreatePullRequestResponse;
        ctx.output('pullRequestUrl', pr.html_url);
        ctx.output('pullRequestNumber', pr.number);
      } finally {
        await fs.rm(cloneDir, { recursive: true, force: true });
      }
    },
  });
}
