const fs = require('fs');

class TeamRepository {
  constructor(teamJsonPath) {
    this._path = teamJsonPath;
  }

  resolve(name) {
    const normalized = name.toLowerCase().trim();
    const { members } = this._load();
    return members.find((m) => m.aliases.some((a) => a.toLowerCase() === normalized)) ?? null;
  }

  getAllNames() {
    return this._load().members.map((m) => m.displayName);
  }

  getAllAliases() {
    return this._load().members.flatMap((m) => m.aliases);
  }

  _load() {
    return JSON.parse(fs.readFileSync(this._path, 'utf-8'));
  }
}

module.exports = TeamRepository;
