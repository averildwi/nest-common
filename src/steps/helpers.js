const path = require('path');

/** Display a path relative to the project root with forward slashes. */
function rel(ctx, absolutePath) {
    return path.relative(ctx.projectRoot, absolutePath).split(path.sep).join('/');
}

module.exports = { rel };
