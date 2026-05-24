// Lightweight tagged logger.

const ts = () => new Date().toISOString();

function format(tag, args) {
  return [`[${ts()}] [${tag}]`, ...args];
}

export const log = {
  info: (tag, ...args) => console.log(...format(tag, args)),
  warn: (tag, ...args) => console.warn(...format(tag, args)),
  error: (tag, ...args) => console.error(...format(tag, args)),
  debug: (tag, ...args) => {
    if (process.env.SOCKET_DEBUG === 'true') console.log(...format(`debug:${tag}`, args));
  },
};
