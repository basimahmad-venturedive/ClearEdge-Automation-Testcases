class RunCreator {
  constructor({ client, projectId, mappingStore, runName, environment }) {
    this.client = client;
    this.projectId = projectId;
    this.mappingStore = mappingStore;
    this.runName = runName;
    this.environment = environment;
  }

  async createRun(caseIds) {
    const runName = this.buildRunName();
    const run = await this.client.addRun(this.projectId, {
      name: runName,
      include_all: false,
      case_ids: caseIds
    });

    const runContext = {
      runId: run.id,
      runUrl: run.url,
      runName,
      caseIds,
      createdAt: new Date().toISOString()
    };

    this.mappingStore.saveRunContext(runContext);
    return runContext;
  }

  buildRunName() {
    const timestamp = new Date().toISOString().replace('T', ' ').replace(/\..+/, '');
    return `${this.runName} - ${this.environment} - ${timestamp}`;
  }
}

module.exports = { RunCreator };
