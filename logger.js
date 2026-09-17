const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const COLORS = { debug: '\x1b[90m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };
const RESET = '\x1b[0m';

function formatArg(arg) {
    if (arg instanceof Error) return arg.cause ? `${arg.message} (${formatArg(arg.cause)})` : arg.message;
    if (typeof arg === 'object' && arg !== null) return JSON.stringify(arg);
    return String(arg);
}

/**
 * Minimal leveled logger. Level comes from LOG_LEVEL (debug|info|warn|error, default info).
 * Options are injectable for tests: { level, write, color }.
 */
function createLogger(scope, opts = {}) {
    const levelName = opts.level ?? process.env.LOG_LEVEL ?? 'info';
    const threshold = LEVELS[levelName.toLowerCase()] ?? LEVELS.info;
    const write = opts.write ?? (line => process.stdout.write(line + '\n'));
    const color = opts.color ?? Boolean(process.stdout.isTTY);

    function emit(level, args) {
        if (LEVELS[level] < threshold) return;
        const label = level.toUpperCase().padEnd(5);
        const coloredLabel = color ? `${COLORS[level]}${label}${RESET}` : label;
        const message = args.map(formatArg).join(' ');
        write(`${new Date().toISOString()} ${coloredLabel} [${scope}] ${message}`);
    }

    return {
        debug: (...args) => emit('debug', args),
        info: (...args) => emit('info', args),
        warn: (...args) => emit('warn', args),
        error: (...args) => emit('error', args),
        isDebug: () => threshold <= LEVELS.debug,
        level: levelName,
    };
}

module.exports = { createLogger, LEVELS };
