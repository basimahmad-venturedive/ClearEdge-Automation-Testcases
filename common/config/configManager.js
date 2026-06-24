import environment from '../environment/environmentManager.js';

/**
 * Config manager — single access point for framework configuration.
 */
class ConfigManager {
  get env() {
    return environment.getEnv();
  }

  get baseUrl() {
    return environment.getBaseUrl();
  }

  get apiBaseUrl() {
    return environment.getApiBaseUrl();
  }

  get timeout() {
    return environment.getTimeout();
  }

  get credentials() {
    return environment.getCredentials();
  }

  get testRail() {
    return environment.getTestRailConfig();
  }

  get reporting() {
    return {
      extent: environment.isExtentEnabled(),
      testRail: environment.isTestRailEnabled(),
    };
  }
}

const config = new ConfigManager();
export default config;
