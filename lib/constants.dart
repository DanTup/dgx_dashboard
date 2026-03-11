/// Number of seconds between each Docker container poll.
const dockerPollSeconds = 10;

/// Number of events to keep on the charts, and to transmit to new connections.
const keepEvents = 20;

/// The maximum number of times we'll restart nvidia-smi if it's crashing.
const maxNvidiaSmiRestarts = 10;

/// Number of consecutive successful metrics before resetting the restart
/// counter. Prevents transient failures from accumulating over long uptime.
const consecutiveSuccessesBeforeReset = 10;

/// Number of seconds between each metrics poll.
const pollSeconds = 5;
