const mysql = require("mysql2");
const { env } = require("./env");

const pool = mysql.createPool({
  host: env.dbHost,
  user: env.dbUser,
  password: env.dbPassword,
  database: env.dbName,
  waitForConnections: true,
  connectionLimit: 5, // Reduced from 10. 5 persistent connections is PLENTY for Node's asynchronous flow, mathematically doubling the safety margin for max limits.
  maxIdle: 5, // Max idle connections, the pool will close excess connections, reducing total socket count.
  idleTimeout: 60000, // Idle connections timeout, in milliseconds.
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  connectTimeout: 10000,
});

// Debug tool for connection
pool.on("error", (err) => {
  console.error("📊 Pool Error:", err);
});

// Safeguard helper: Recursively replaces `undefined` with `null` in bind parameters to satisfy mysql2's strict validation
const sanitizeParams = (params) => {
  if (params === undefined) return null;
  if (Array.isArray(params)) {
    return params.map(sanitizeParams);
  }
  return params;
};

// Wraps original query/execute methods to intercept and sanitize parameters
const wrapQueryMethod = (originalMethod, target) => {
  return function(...args) {
    // Case 1: First argument is options object containing values
    if (args[0] && typeof args[0] === 'object') {
      if (args[0].values !== undefined) {
        args[0].values = sanitizeParams(args[0].values);
      }
    }
    // Case 2: Second argument is the parameter array or object
    if (args.length > 1 && typeof args[1] !== 'function') {
      args[1] = sanitizeParams(args[1]);
    }
    const ctx = target || this;
    return originalMethod.apply(ctx, args);
  };
};

const connectionProxyHandler = {
  get(target, prop, receiver) {
    if (typeof prop === 'symbol') {
      return Reflect.get(target, prop, receiver);
    }
    if (prop === 'promise') {
      return function() {
        return receiver;
      };
    }
    if (prop === 'connection') {
      const val = Reflect.get(target, prop, receiver);
      return new Proxy(val, connectionProxyHandler);
    }
    const val = Reflect.get(target, prop, receiver);
    if (typeof val === 'function') {
      if (prop === 'query' || prop === 'execute') {
        return wrapQueryMethod(val, target);
      }
      return val.bind(target);
    }
    return val;
  }
};

const poolProxyHandler = {
  get(target, prop, receiver) {
    if (typeof prop === 'symbol') {
      return Reflect.get(target, prop, receiver);
    }
    if (prop === 'promise') {
      return function() {
        return receiver;
      };
    }
    if (prop === 'pool') {
      const val = Reflect.get(target, prop, receiver);
      return new Proxy(val, poolProxyHandler);
    }
    const val = Reflect.get(target, prop, receiver);
    if (typeof val === 'function') {
      if (prop === 'query' || prop === 'execute') {
        return wrapQueryMethod(val, target);
      }
      if (prop === 'getConnection') {
        return function(...args) {
          const lastArg = args[args.length - 1];
          if (typeof lastArg === 'function') {
            const originalCallback = lastArg;
            args[args.length - 1] = function(err, conn) {
              if (conn) {
                conn = new Proxy(conn, connectionProxyHandler);
              }
              originalCallback(err, conn);
            };
            return val.apply(target, args);
          } else {
            return (async () => {
              const conn = await val.apply(target, args);
              return new Proxy(conn, connectionProxyHandler);
            })();
          }
        };
      }
      return val.bind(target);
    }
    return val;
  }
};

const rawPromisePool = pool.promise();
const wrappedDb = new Proxy(rawPromisePool, poolProxyHandler);

module.exports = wrappedDb;

