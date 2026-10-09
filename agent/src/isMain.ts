import { pathToFileURL } from "node:url";

/**
 * True when the module whose `import.meta.url` is passed in is the script Node was started with.
 * Compares URLs rather than `file://${argv[1]}`, which never matches on Windows (backslashes, drive letter).
 */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  return entry !== undefined && moduleUrl === pathToFileURL(entry).href;
}
