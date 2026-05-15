declare module 'better-sqlite3' {
  class Database {
    constructor(filename: string, options?: any);
    prepare(sql: string): Statement;
    exec(sql: string): void;
    transaction<T extends any[]>(fn: (...args: T) => void): (...args: T) => void;
    pragma(pragma: string, options?: { simple?: boolean }): any;
    close(): void;
  }

  interface Statement {
    run(...params: any[]): RunResult;
    get(...params: any[]): any;
    all(...params: any[]): any[];
    iterate(...params: any[]): IterableIterator<any>;
  }

  interface RunResult {
    lastInsertRowid: number;
    changes: number;
  }

  export default Database;
}
