const logger = {
  trace: (...args) => console.trace(...args),
  debug: (...args) => console.debug(...args),
  info: (...args) => console.info(...args),
  warn: (...args) => console.warn(...args),
  error: (...args) => console.error(...args),
  setLevel: () => {},
  getLevel: () => "error",
  enableAll: () => {},
  disableAll: () => {},
};

export default logger;
