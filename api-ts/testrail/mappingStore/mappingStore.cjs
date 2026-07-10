const fs = require('node:fs');
const path = require('node:path');

class MappingStore {
  constructor(mappingFile, runContextFile) {
    this.mappingFile = mappingFile;
    this.runContextFile = runContextFile;
  }

  loadMapping() {
    return this.readJson(this.mappingFile, {});
  }

  saveMapping(mapping) {
    this.writeJson(this.mappingFile, mapping);
  }

  loadRunContext() {
    return this.readJson(this.runContextFile, {});
  }

  saveRunContext(runContext) {
    this.writeJson(this.runContextFile, runContext);
  }

  readJson(filePath, fallback) {
    if (!fs.existsSync(filePath)) {
      return fallback;
    }

    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  }

  writeJson(filePath, data) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`);
  }
}

module.exports = { MappingStore };
