import ExtentReportManager from '../extent/extentReportManager.js';
import logger from '../logger/logger.js';

const manager = new ExtentReportManager();

class ExtentReporter {
  onBegin(config, suite) {
    manager.onBegin(config, suite);
  }

  onTestEnd(test, result) {
    manager.onTestEnd(test, result);
  }

  onEnd(result) {
    manager.onEnd(result);
    logger.info(`Extent reporter finished. ${result.status}`);
  }
}

export default ExtentReporter;
