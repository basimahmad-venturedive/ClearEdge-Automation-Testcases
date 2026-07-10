class ResultPublisher {
  constructor({ client, runId }) {
    this.client = client;
    this.runId = runId;
  }

  async publish(results) {
    if (results.length === 0) {
      return;
    }

    await this.client.addResultsForCases(this.runId, results);
  }
}

module.exports = { ResultPublisher };
