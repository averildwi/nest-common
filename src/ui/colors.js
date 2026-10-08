/**
 * Minimal ANSI styling with no dependencies.
 *
 * Colour is disabled when output is not a TTY, when NO_COLOR is set
 * (https://no-color.org) or when TERM=dumb. FORCE_COLOR overrides all of that.
 */
function supportsColor() {
    const env = process.env;
    if ('FORCE_COLOR' in env) return env.FORCE_COLOR !== '0';
    if ('NO_COLOR' in env) return false;
    if (env.TERM === 'dumb') return false;
    return Boolean(process.stdout.isTTY);
}

let enabled = supportsColor();

function wrap(open, close) {
    return (text) => (enabled ? `\x1b[${open}m${text}\x1b[${close}m` : String(text));
}

const colors = {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    blue: wrap(34, 39),
    magenta: wrap(35, 39),
    cyan: wrap(36, 39),
    gray: wrap(90, 39),
};

function setColorEnabled(value) {
    enabled = Boolean(value);
}

module.exports = { colors, setColorEnabled, supportsColor };
