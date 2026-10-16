import { createBackendModule } from '@backstage/backend-plugin-api';
import { actionsRegistryServiceRef } from '@backstage/backend-plugin-api/alpha';
import { registerPlatformPingAction } from './actions/platformPing';

export const mcpActionsModuleSkylab = createBackendModule({
  pluginId: 'mcp-actions',
  moduleId: 'skylab',
  register({ registerInit }) {
    registerInit({
      deps: {
        actionsRegistry: actionsRegistryServiceRef,
      },
      async init({ actionsRegistry }) {
        registerPlatformPingAction({ actionsRegistry });
      },
    });
  },
});
