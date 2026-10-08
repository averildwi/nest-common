/**
 * An expected, user-facing failure. Thrown anywhere in the CLI and rendered by
 * the entrypoint as a clean message (plus optional hints) instead of a stack
 * trace.
 */
class CliError extends Error {
    /**
     * @param {string} message
     * @param {{ hints?: string[], exitCode?: number, cause?: unknown }} [options]
     */
    constructor(message, { hints = [], exitCode = 1, cause } = {}) {
        super(message);
        this.name = 'CliError';
        this.hints = hints;
        this.exitCode = exitCode;
        if (cause) this.cause = cause;
    }
}

/** Raised when the user aborts (Ctrl+C or answering "no" to the confirmation). */
class CancelledError extends CliError {
    constructor(message = 'Cancelled. No changes were made.') {
        super(message, { exitCode: 130 });
        this.name = 'CancelledError';
    }
}

module.exports = { CliError, CancelledError };
