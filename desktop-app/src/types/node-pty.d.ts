/**
 * Minimal typings for node-pty (native module, no bundled types for our
 * import site). Only the surface we use is declared.
 */
declare module 'node-pty' {
  export interface IPty {
    readonly pid: number;
    onData(callback: (data: string) => void): void;
    onExit(callback: (event: {exitCode: number; signal?: number}) => void): void;
    write(data: string): void;
    resize(cols: number, rows: number): void;
    kill(signal?: string): void;
  }

  export interface IPtyForkOptions {
    name?: string;
    cols?: number;
    rows?: number;
    cwd?: string;
    env?: NodeJS.ProcessEnv | {[key: string]: string | undefined};
  }

  export function spawn(file: string, args: string[], options: IPtyForkOptions): IPty;
}
