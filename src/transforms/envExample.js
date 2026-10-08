/**
 * Merges the required env blueprint into .env.example content.
 * Missing keys are appended under an "# Added by @averildwi/nest-common"
 * marker so a user-managed file keeps its own layout.
 */
function buildEnvFile(blueprint) {
    let content = '';
    for (const [key, value] of Object.entries(blueprint)) {
        content += `${key}="${value}"\n`;
    }
    return content;
}

/** Returns the keys from the blueprint that the env file is missing. */
function missingKeys(source, blueprint) {
    const missing = [];
    for (const key of Object.keys(blueprint)) {
        if (!new RegExp(`^${key}\\s*=`, 'm').test(source)) missing.push(key);
    }
    return missing;
}

function mergeEnv(source, blueprint) {
    const missing = missingKeys(source, blueprint);
    if (missing.length === 0) return { source, added: [] };

    const lines = missing.map((key) => `${key}="${blueprint[key]}"\n`).join('');
    return {
        source: `${source.trimEnd()}\n\n# Added by @averildwi/nest-common\n${lines}`,
        added: missing,
    };
}

module.exports = { buildEnvFile, missingKeys, mergeEnv };
