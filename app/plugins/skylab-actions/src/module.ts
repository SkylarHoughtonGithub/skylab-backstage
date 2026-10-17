import {
  coreServices,
  createBackendModule,
} from '@backstage/backend-plugin-api';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import { argocdServiceRef } from '@roadiehq/backstage-plugin-argo-cd-node';
import { registerPlatformPingAction } from './actions/platformPing';
import { registerArgocdRecentFailuresAction } from './actions/argocdRecentFailures';

export const mcpActionsModuleSkylab = createBackendModule({
  pluginId: 'mcp-actions',
  moduleId: 'skylab',
  register({ registerInit }) {
    registerInit({
      deps: {
        actionsRegistry: actionsRegistryServiceRef,
        argocdService: argocdServiceRef,
        logger: coreServices.logger,
      },
      async init({ actionsRegistry, argocdService, logger }) {
        registerPlatformPingAction({ actionsRegistry });
        registerArgocdRecentFailuresAction({
          actionsRegistry,
          argocdService,
          logger,
        });
      },
    });
  },
});
