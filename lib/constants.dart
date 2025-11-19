/// Number of seconds between each Docker container poll.
const dockerPollSeconds = 30;

/// Number of events to keep on the charts, and to transmit to new connections.
const keepEvents = 10;

/// The maximum number of times we'll restart nvidia-smi if it's crashing.
const maxNvidiaSmiRestarts = 5;

/// Number of seconds between each metrics poll.
const pollSeconds = 5;
