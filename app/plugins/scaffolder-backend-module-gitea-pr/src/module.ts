import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { scaffolderActionsExtensionPoint } from '@backstage/plugin-scaffolder-node';
import { ScmIntegrations } from '@backstage/integration';
import { createGiteaPullRequestAction } from './actions/createGiteaPullRequest';

export const scaffolderModuleGiteaPullRequest = createBackendModule({
  pluginId: 'scaffolder',
  moduleId: 'gitea-pull-request',
  register({ registerInit }) {
    registerInit({
      deps: {
        config: coreServices.rootConfig,
        scaffolderActions: scaffolderActionsExtensionPoint,
      },
      async init({ config, scaffolderActions }) {
        const integrations = ScmIntegrations.fromConfig(config);
        scaffolderActions.addActions(
          createGiteaPullRequestAction({ integrations }),
        );
      },
    });
  },
});
