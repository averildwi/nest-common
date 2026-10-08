const { colors: c } = require('./colors');

const symbols = {
    success: c.green('✔'),
    error: c.red('✖'),
    warning: c.yellow('⚠'),
    info: c.blue('ℹ'),
    skip: c.gray('-'),
};

const out = (line = '') => process.stdout.write(`${line}\n`);

function header(title, subtitle) {
    out();
    out(`  ${c.bold(c.magenta(title))}${subtitle ? `  ${c.gray(subtitle)}` : ''}`);
    out();
}

function section(title) {
    out();
    out(`  ${c.bold(title)}`);
}

function step(index, total, title) {
    out();
    out(`  ${c.cyan(`[${index}/${total}]`)} ${c.bold(title)}`);
}

function success(msg) {
    out(`  ${symbols.success} ${msg}`);
}

function warn(msg) {
    out(`  ${symbols.warning} ${c.yellow(msg)}`);
}

function info(msg) {
    out(`  ${symbols.info} ${msg}`);
}

function skip(msg) {
    out(`  ${symbols.skip} ${c.gray(msg)}`);
}

function detail(msg) {
    out(`      ${c.gray(msg)}`);
}

function error(msg) {
    process.stderr.write(`\n  ${symbols.error} ${c.red(c.bold(msg))}\n`);
}

function hint(msg) {
    process.stderr.write(`    ${c.gray(msg)}\n`);
}

/** Aligned two-column key/value list. */
function keyValues(rows) {
    const width = Math.max(...rows.map(([k]) => k.length));
    for (const [key, value] of rows) {
        out(`    ${c.gray(key.padEnd(width))}  ${value}`);
    }
}

function code(lines) {
    for (const line of [].concat(lines)) {
        out(`      ${c.cyan(line)}`);
    }
}

module.exports = {
    symbols,
    out,
    header,
    section,
    step,
    success,
    warn,
    info,
    skip,
    detail,
    error,
    hint,
    keyValues,
    code,
};
