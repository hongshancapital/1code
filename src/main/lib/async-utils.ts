/**
 * 异步包装器 - 将同步数据库操作放到 setImmediate 中执行
 * 避免阻塞主进程事件循环
 */
export function dbGetAsync<T>(query: { get: () => T }): Promise<T> {
  return new Promise((resolve) => {
    setImmediate(() => {
      const result = query.get();
      resolve(result);
    });
  });
}

export function dbRunAsync(query: { run: () => void }): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(() => {
      query.run();
      resolve();
    });
  });
}

/**
 * 异步包装器 - 将 JSON 序列化/反序列化放到 setImmediate 中执行
 * 避免大 JSON 阻塞主进程
 */
export function jsonParseAsync<T>(text: string): Promise<T> {
  return new Promise((resolve) => {
    setImmediate(() => {
      const result = JSON.parse(text);
      resolve(result);
    });
  });
}

export function jsonStringifyAsync(value: unknown): Promise<string> {
  return new Promise((resolve) => {
    setImmediate(() => {
      const result = JSON.stringify(value);
      resolve(result);
    });
  });
}
